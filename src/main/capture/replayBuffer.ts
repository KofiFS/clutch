import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { CaptureSettings, Encoder } from '../../shared/types'
import { detectEncoders, ffmpegPath, run } from './ffmpeg'

const SEG_SECONDS = 2
const SYS_RATE = 48000
const SYS_CHANNELS = 2
const SYS_BYTES_PER_SEC = SYS_RATE * SYS_CHANNELS * 2

export interface SaveRequest {
  /** Wall-clock ms. */
  startMs: number
  endMs: number
  /** Destination mp4 path. */
  outFile: string
}

export interface BufferEvents {
  status: [{ running: boolean; encoder?: string; resolution?: string; fps?: number; error?: string }]
  levels: [{ micDb: number; sysDb: number }]
  /** A downscaled JPEG of the screen, emitted at the configured snapshot rate. */
  snapshot: [Buffer]
  log: [string]
}

/**
 * Keeps the last N seconds of gameplay on disk as 2-second MPEG-TS segments written by a single
 * FFmpeg process. Clips are cut from those segments with stream copy, so saving is instant and
 * never re-encodes.
 *
 *   screen (ddagrab, GPU) ──┐
 *   mic (dshow) ────────────┼─► ffmpeg ─► segments/seg000123.ts (ring, pruned)
 *   system audio (stdin) ───┘        └─► stdout: low-fps JPEG snapshots for the vision trigger
 */
export class ReplayBuffer extends EventEmitter<BufferEvents> {
  private proc: ChildProcess | null = null
  private segDir: string
  private settings: CaptureSettings | null = null
  private pruneTimer: NodeJS.Timeout | null = null
  private sysTimer: NodeJS.Timeout | null = null
  private sysBytesWritten = 0
  private sysStartedAt = 0
  private sysQueue: Buffer[] = []
  private pendingSaves = 0
  private snapshotBuf: Buffer = Buffer.alloc(0)
  private micDb = -100
  private sysDb = -100
  private stopping = false
  private display: { width: number; height: number; crop?: { x: number; y: number; w: number; h: number } } = { width: 0, height: 0 }
  private restarts: number[] = []
  private segStartNumber = 0
  running = false
  encoder: Encoder = 'libx264'
  resolution = ''
  snapshotIntervalSec = 3
  /** While set, segments recorded after this moment are never pruned (long recording). */
  holdFromMs: number | null = null
  snapshotsEnabled = false

  constructor(workDir: string) {
    super()
    this.segDir = path.join(workDir, 'buffer')
  }

  async start(settings: CaptureSettings, display: { width: number; height: number; crop?: { x: number; y: number; w: number; h: number } }, opts: { restart?: boolean } = {}): Promise<void> {
    if (this.running) await this.stop()
    this.settings = settings
    this.display = display
    this.stopping = false
    if (!opts.restart && this.holdFromMs === null) {
      fs.rmSync(this.segDir, { recursive: true, force: true })
      this.restarts = []
    }
    fs.mkdirSync(this.segDir, { recursive: true })
    const existing = this.listSegments()
    this.segStartNumber = existing.length ? existing[existing.length - 1].n + 1 : 0

    const enc = await detectEncoders()
    this.encoder = settings.encoder === 'auto' ? enc.best : enc.available.includes(settings.encoder) ? settings.encoder : enc.best
    const srcW = display.crop?.w ?? display.width
    const srcH = display.crop?.h ?? display.height
    const w = Math.round(srcW * settings.resolutionScale)
    const h = Math.round(srcH * settings.resolutionScale)
    let fitScale = 1
    if ((w > 4096 || h > 4096) && (this.encoder === 'h264_nvenc' || this.encoder === 'h264_amf' || this.encoder === 'h264_qsv')) {
      // H.264 hardware encoders stop at 4096 px; ultrawide / 5K screens need HEVC or AV1, or a downscale.
      const alt = (['hevc_nvenc', 'av1_nvenc'] as Encoder[]).find((e) => enc.available.includes(e))
      if (alt) this.encoder = alt
      else fitScale = Math.min(4096 / w, 4096 / h)
    }
    this.resolution = `${Math.round(w * fitScale)}x${Math.round(h * fitScale)}`
    const args = this.buildArgs(settings, this.encoder, settings.resolutionScale * fitScale)
    console.log('[ffmpeg]', args.join(' '))

    const proc = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    this.running = true

    let stderrTail = ''
    proc.stderr!.setEncoding('utf8')
    proc.stderr!.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4000)
      for (const line of chunk.split(/\r?\n/)) {
        const m = line.match(/RMS_level=(-?[\d.]+|-inf)/)
        if (m) {
          this.micDb = m[1] === '-inf' ? -100 : Number(m[1])
          this.emit('levels', { micDb: this.micDb, sysDb: this.sysDb })
        } else if (/error|failed|invalid|cannot|could not|exceeds|doesn't support/i.test(line) && !/Guessed Channel|deprecated pixel/i.test(line) && line.trim()) {
          this.emit('log', line.trim())
        }
      }
    })
    proc.stdout!.on('data', (chunk: Buffer) => this.onSnapshotData(chunk))
    proc.on('exit', (code) => {
      const wasRunning = this.running
      this.cleanup()
      if (wasRunning && !this.stopping) {
        const err = `FFmpeg exited (code ${code}). ${stderrTail.split('\n').filter((l) => /error|invalid|not found|could not/i.test(l)).slice(-3).join(' | ')}`
        this.emit('status', { running: false, error: err })
      } else {
        this.emit('status', { running: false })
      }
    })
    proc.stdin!.on('error', () => {})

    if (settings.systemAudio) this.startSystemAudioPump()
    this.pruneTimer = setInterval(() => this.prune(), 5000)
    this.emit('status', { running: true, encoder: this.encoder, resolution: this.resolution, fps: settings.fps })
  }

  async stop(): Promise<void> {
    if (!this.proc) return
    this.stopping = true
    const p = this.proc
    const usesStdinForAudio = !!this.settings?.systemAudio
    await new Promise<void>((resolve) => {
      let killed = false
      const kill = () => { if (!killed) { killed = true; p.kill('SIGKILL') } }
      // Give up waiting entirely after a few seconds, but always try to see the exit first so
      // "running" is false before anyone starts the next recording.
      const hard = setTimeout(resolve, 4000)
      p.once('exit', () => { clearTimeout(hard); resolve() })
      if (usesStdinForAudio) {
        // stdin is the system-audio PCM pipe, so a 'q' would just be audio. Segments are already on
        // disk; ending the process is safe.
        kill()
      } else {
        try { p.stdin?.write('q') } catch { /* ignore */ }
        try { p.stdin?.end() } catch { /* ignore */ }
        setTimeout(kill, 2000)
      }
    })
    this.cleanup()
    this.emit('status', { running: false })
  }

  private cleanup() {
    this.running = false
    this.proc = null
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    if (this.sysTimer) clearInterval(this.sysTimer)
    this.pruneTimer = this.sysTimer = null
    this.sysQueue = []
  }

  /** Renderer pushes 16-bit stereo 48 kHz PCM captured via Electron's loopback. */
  pushSystemAudio(pcm: Buffer, levelDb: number) {
    this.sysDb = levelDb
    if (!this.running || !this.settings?.systemAudio) return
    this.sysQueue.push(pcm)
  }

  /**
   * Feeds ffmpeg's stdin at exactly real-time. If the renderer stops delivering audio (no loopback,
   * window closed), silence is written instead so the muxer never stalls waiting for input.
   */
  private startSystemAudioPump() {
    this.sysBytesWritten = 0
    this.sysStartedAt = Date.now()
    this.sysTimer = setInterval(() => {
      if (!this.proc?.stdin || !this.running) return
      const target = Math.floor(((Date.now() - this.sysStartedAt) / 1000) * SYS_BYTES_PER_SEC) & ~3
      let need = target - this.sysBytesWritten
      while (need > 0 && this.sysQueue.length) {
        const chunk = this.sysQueue.shift()!
        this.proc.stdin.write(chunk)
        this.sysBytesWritten += chunk.length
        need -= chunk.length
      }
      if (need > 0) {
        this.proc.stdin.write(Buffer.alloc(need & ~3))
        this.sysBytesWritten += need & ~3
      }
      // Drop stale audio so we never run more than ~0.5 s behind real time.
      let queued = this.sysQueue.reduce((n, b) => n + b.length, 0)
      while (queued > SYS_BYTES_PER_SEC / 2 && this.sysQueue.length) queued -= this.sysQueue.shift()!.length
    }, 50)
  }

  private onSnapshotData(chunk: Buffer) {
    this.snapshotBuf = Buffer.concat([this.snapshotBuf, chunk])
    for (;;) {
      const start = this.snapshotBuf.indexOf(Buffer.from([0xff, 0xd8, 0xff]))
      if (start < 0) { this.snapshotBuf = Buffer.alloc(0); return }
      const end = this.snapshotBuf.indexOf(Buffer.from([0xff, 0xd9]), start + 3)
      if (end < 0) { if (start > 0) this.snapshotBuf = this.snapshotBuf.subarray(start); return }
      const jpeg = Buffer.from(this.snapshotBuf.subarray(start, end + 2))
      this.snapshotBuf = this.snapshotBuf.subarray(end + 2)
      this.emit('snapshot', jpeg)
    }
  }

  private buildArgs(s: CaptureSettings, encoder: Encoder, scale: number): string[] {
    const useD3D = encoder.endsWith('_nvenc') && scale === 1
    // 'info' is needed: the mic level printer (ametadata) logs at info level.
    const args = ['-hide_banner', '-loglevel', 'info', '-nostats', '-y']
    args.push('-init_hw_device', 'd3d11va')

    // Inputs
    const inputs: string[] = []
    let micIdx = -1
    let sysIdx = -1
    if (s.micDevice) {
      micIdx = inputs.length
      inputs.push('-f', 'dshow', '-rtbufsize', '64M', '-thread_queue_size', '2048', '-i', `audio=${s.micDevice}`)
    }
    if (s.systemAudio) {
      sysIdx = inputs.length ? 1 : 0
      inputs.push('-f', 's16le', '-ar', String(SYS_RATE), '-ac', String(SYS_CHANNELS), '-thread_queue_size', '2048', '-i', 'pipe:0')
    }
    args.push(...inputs)

    // Filter graph
    const crop = this.display.crop
    const cropArgs = crop ? `:offset_x=${crop.x}:offset_y=${crop.y}:video_size=${crop.w}x${crop.h}` : ''
    const grab = `ddagrab=output_idx=${s.monitorIndex}:framerate=${s.fps}:draw_mouse=1${cropArgs}`
    const scaleExpr = scale === 1 ? '' : `,scale=trunc(iw*${scale}/2)*2:trunc(ih*${scale}/2)*2`
    const parts: string[] = []
    // The screenshot branch only exists while AI watching is on; otherwise frames never leave the GPU
    // for anything but the encoder (NVENC at native res) and FFmpeg does no extra work.
    const snaps = this.snapshotsEnabled
    const split = snaps ? ',split=2[v][vsnap0]' : '[v]'
    if (useD3D) {
      parts.push(`${grab},setpts=PTS-STARTPTS${split}`)
    } else {
      parts.push(`${grab},setpts=PTS-STARTPTS,hwdownload,format=bgra${scaleExpr},format=nv12${split}`)
    }
    if (snaps) {
      // Drop to a low frame rate *before* pulling frames off the GPU.
      const snapDownload = useD3D ? ',hwdownload,format=bgra' : ''
      parts.push(`[vsnap0]fps=1/${this.snapshotIntervalSec}${snapDownload},scale=1024:-2,format=yuvj420p[snap]`)
    }

    const audioLabels: string[] = []
    if (micIdx >= 0) {
      // Every input is rebased to t=0 so dshow's clock (seconds since boot) lines up with the pipe and video.
      parts.push(`[${micIdx}:a]asetpts=PTS-STARTPTS,asplit=2[micA][micB]`)
      parts.push(`[micB]asetnsamples=n=4800:p=0,astats=metadata=1:reset=1:measure_overall=RMS_level:measure_perchannel=none,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:direct=1,anullsink`)
      audioLabels.push('[micA]')
    }
    if (sysIdx >= 0) {
      parts.push(`[${sysIdx}:a]asetpts=PTS-STARTPTS,aresample=async=1000[sysA]`)
      audioLabels.push('[sysA]')
    }
    let audioOut = ''
    if (audioLabels.length === 2) {
      parts.push(`${audioLabels.join('')}amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a]`)
      audioOut = '[a]'
    } else if (audioLabels.length === 1) {
      audioOut = audioLabels[0]
    }
    args.push('-filter_complex', parts.join(';'))

    // Segment output
    args.push('-map', '[v]')
    if (audioOut) args.push('-map', audioOut)
    args.push(...this.encoderArgs(encoder, s))
    args.push('-force_key_frames', `expr:gte(t,n_forced*${SEG_SECONDS})`)
    if (audioOut) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000')
    args.push('-f', 'segment', '-segment_time', String(SEG_SECONDS), '-segment_format', 'mpegts', '-reset_timestamps', '1', '-segment_start_number', String(this.segStartNumber), path.join(this.segDir, 'seg%06d.ts'))

    // Snapshot output (stdout)
    if (snaps) args.push('-map', '[snap]', '-c:v', 'mjpeg', '-q:v', '6', '-f', 'image2pipe', 'pipe:1')

    return args
  }

  private encoderArgs(encoder: Encoder, s: CaptureSettings): string[] {
    const gop = String(s.fps * SEG_SECONDS)
    switch (encoder) {
      case 'h264_nvenc':
      case 'hevc_nvenc':
      case 'av1_nvenc':
        return ['-c:v', encoder, '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', String(s.quality), '-b:v', '0', '-maxrate', '120M', '-bufsize', '240M', '-g', gop, '-bf', '0', '-spatial-aq', '1']
      case 'h264_amf':
        return ['-c:v', encoder, '-rc', 'cqp', '-qp_i', String(s.quality), '-qp_p', String(s.quality), '-g', gop, '-bf', '0']
      case 'h264_qsv':
        return ['-c:v', encoder, '-global_quality', String(s.quality), '-g', gop, '-bf', '0']
      default:
        return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(s.quality), '-g', gop, '-bf', '0', '-pix_fmt', 'yuv420p']
    }
  }

  private listSegments(): { file: string; n: number; birthMs: number }[] {
    let names: string[] = []
    try { names = fs.readdirSync(this.segDir).filter((f) => /^seg\d+\.ts$/.test(f)) } catch { return [] }
    const segs = names.map((f) => {
      const st = fs.statSync(path.join(this.segDir, f))
      return { file: path.join(this.segDir, f), n: Number(f.slice(3, -3)), birthMs: st.birthtimeMs || st.mtimeMs - SEG_SECONDS * 1000 }
    })
    return segs.sort((a, b) => a.n - b.n)
  }

  private prune() {
    if (!this.settings || this.pendingSaves > 0) return
    const normal = Date.now() - (this.settings.bufferSeconds + 10) * 1000
    const keepAfter = this.holdFromMs === null ? normal : Math.min(normal, this.holdFromMs - SEG_SECONDS * 2000)
    for (const seg of this.listSegments()) {
      if (seg.birthMs < keepAfter) {
        try { fs.unlinkSync(seg.file) } catch { /* in use */ }
      }
    }
  }

  /** Oldest moment still available in the buffer (wall-clock ms), or null if empty. */
  oldestAvailableMs(): number | null {
    const segs = this.listSegments()
    return segs.length ? segs[0].birthMs : null
  }

  /**
   * Cut [startMs, endMs] out of the buffer into an mp4. Resolves once the clip is on disk.
   * Waits for the future part of the range to be recorded first.
   */
  async saveRange(req: SaveRequest): Promise<{ file: string; actualStartMs: number }> {
    if (!this.running) throw new Error('Replay buffer is not running')
    this.pendingSaves++
    try {
      const readyAt = req.endMs + (SEG_SECONDS + 0.75) * 1000
      if (Date.now() < readyAt) await new Promise((r) => setTimeout(r, readyAt - Date.now()))
      if (!this.running) throw new Error('Replay buffer stopped while saving')

      const segs = this.listSegments()
      const last = segs[segs.length - 1]
      const chosen = segs.filter((sg) => sg !== last && sg.birthMs + SEG_SECONDS * 1000 > req.startMs && sg.birthMs < req.endMs)
      if (!chosen.length) throw new Error('No buffered video covers that range yet')

      const listFile = path.join(this.segDir, `clip-${Date.now()}.txt`)
      fs.writeFileSync(listFile, chosen.map((sg) => `file '${sg.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
      const offsetSec = Math.max(0, (req.startMs - chosen[0].birthMs) / 1000)
      const durationSec = (req.endMs - req.startMs) / 1000
      fs.mkdirSync(path.dirname(req.outFile), { recursive: true })
      const r = await run(ffmpegPath(), [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', offsetSec.toFixed(2), '-f', 'concat', '-safe', '0', '-i', listFile,
        '-t', durationSec.toFixed(2), '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', req.outFile
      ], { timeoutMs: 120_000 })
      try { fs.unlinkSync(listFile) } catch { /* ignore */ }
      if (r.code !== 0 || !fs.existsSync(req.outFile)) throw new Error(`Clip export failed: ${r.stderr.trim().split('\n').pop()}`)
      const actualStartMs = chosen[0].birthMs + Math.floor(offsetSec / SEG_SECONDS) * SEG_SECONDS * 1000
      return { file: req.outFile, actualStartMs }
    } finally {
      this.pendingSaves--
    }
  }
}
