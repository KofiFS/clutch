import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { CaptureSettings, Encoder } from '../../shared/types'
import { detectEncoders, ffmpegPath, ffprobePath, lowerPriority, run } from './ffmpeg'
import { AppAudioSource } from './appAudio'

const SEG_SECONDS = 2
/** No new segment for this long while running counts as a stalled recorder. */
const STALL_MS = 9000
const SYS_RATE = 48000
const SYS_CHANNELS = 2
const SYS_BYTES_PER_SEC = SYS_RATE * SYS_CHANNELS * 2

/** What to record: a whole monitor (optionally cropped), or one window. */
export interface CaptureSource {
  width: number
  height: number
  crop?: { x: number; y: number; w: number; h: number }
  /** DXGI output to duplicate (screen capture); defaults to the monitor setting. */
  outputIdx?: number
  /** Capture this window itself; width/height are its size. */
  window?: { hwnd: string }
}

export interface SaveRequest {
  /** Wall-clock ms. */
  startMs: number
  endMs: number
  /** Destination mp4 path. */
  outFile: string
  /** Save from the segments on disk even though FFmpeg is stopped (recording paused). */
  allowStopped?: boolean
}

export interface BufferEvents {
  status: [{ running: boolean; encoder?: string; resolution?: string; fps?: number; error?: string }]
  levels: [{ micDb: number; sysDb: number; sources: Record<string, number> }]
  /** A downscaled JPEG of the screen, emitted at the configured snapshot rate. */
  snapshot: [Buffer]
  /** Alive but no segment finished for a while: the recorder should restart it. */
  stall: [{ seconds: number; stderr: string }]
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
  /** Per-app audio (e.g. Discord on its own track), served to FFmpeg over named pipes. */
  private appSources = new Map<string, AppAudioSource>()
  private appLevelTimer: NodeJS.Timeout | null = null
  private pendingSaves = 0
  /** Start times of saves in progress: their segments are kept until they finish. */
  private pendingHolds: number[] = []
  private watchTimer: NodeJS.Timeout | null = null
  private newestSeg = -1
  private newestChangedAt = 0
  private startedAtMs = 0
  private stderrTail = ''
  private snapshotBuf: Buffer = Buffer.alloc(0)
  private micDb = -100
  private sourceLevels: Record<string, number> = {}
  private triggerIds: string[] = []
  /** Audio track names of the current recording (track 1 is the mix). MPEG-TS drops them, so clips get them back on save. */
  private trackTitles: string[] = []
  /** Mic sources skipped at start because the device is not plugged in. */
  missingSources: string[] = []
  private sysDb = -100
  private stopping = false
  private display: CaptureSource = { width: 0, height: 0 }
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

  get segmentDir() {
    return this.segDir
  }

  async start(settings: CaptureSettings, display: CaptureSource, opts: { restart?: boolean } = {}): Promise<void> {
    if (this.running) await this.stop()
    this.settings = settings
    this.display = display
    this.stopping = false
    if (!opts.restart && this.holdFromMs === null) {
      fs.rmSync(this.segDir, { recursive: true, force: true })
      this.restarts = []
    }
    fs.mkdirSync(this.segDir, { recursive: true })
    // Segments left behind by an earlier run (a crash, an older version) must never end up in a
    // clip or be taken for the newest segment. Held segments (paused long recording) stay.
    const stale = Date.now() - (settings.bufferSeconds + 10) * 1000
    for (const seg of this.listSegments()) {
      const held = this.holdFromMs !== null && seg.birthMs >= this.holdFromMs - SEG_SECONDS * 2000
      if (seg.birthMs < stale && !held) { try { fs.unlinkSync(seg.file) } catch { /* in use */ } }
    }
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
    // App audio pipes must be listening before FFmpeg opens them as inputs.
    for (const a of this.appSources.values()) a.stop()
    this.appSources.clear()
    for (const src of (settings.audioSources ?? []).filter((x) => x.enabled && x.kind === 'app' && x.process)) {
      const a = new AppAudioSource(src.id, src.process!)
      a.onLog = (m) => this.emit('log', m)
      try { await a.listen(); this.appSources.set(src.id, a) } catch (e) { this.emit('log', `App audio for ${src.name} is unavailable: ${e instanceof Error ? e.message : String(e)}`) }
    }
    const args = this.buildArgs(settings, this.encoder, settings.resolutionScale * fitScale)
    console.log('[ffmpeg]', args.join(' '))

    const proc = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    this.running = true
    for (const a of this.appSources.values()) a.start()
    if (this.appSources.size) {
      // App levels for the meters (mic levels come from FFmpeg itself).
      this.appLevelTimer = setInterval(() => {
        for (const [id, a] of this.appSources) this.sourceLevels[id] = a.levelDb
        this.emit('levels', { micDb: this.micDb, sysDb: this.sysDb, sources: this.sourceLevels })
      }, 150)
    }

    this.stderrTail = ''
    proc.stderr!.setEncoding('utf8')
    proc.stderr!.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4000)
      for (const line of chunk.split(/\r?\n/)) {
        const m = line.match(/ametadata@m_([\w-]+) @ [^\]]+\] lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)/)
        if (m) {
          const db = m[2] === '-inf' ? -100 : Number(m[2])
          this.sourceLevels[m[1]] = db
          // "Mic" for the triggers = loudest source marked as a trigger mic.
          this.micDb = Math.max(-100, ...this.triggerIds.map((id) => this.sourceLevels[id] ?? -100))
          this.emit('levels', { micDb: this.micDb, sysDb: this.sysDb, sources: this.sourceLevels })
        } else if (/error|failed|invalid|cannot|could not|exceeds|doesn't support/i.test(line) && !/Guessed Channel|deprecated pixel/i.test(line) && line.trim()) {
          this.emit('log', line.trim())
        }
      }
    })
    proc.stdout!.resume()
    proc.on('exit', (code) => {
      const wasRunning = this.running
      this.cleanup()
      if (wasRunning && !this.stopping) {
        const err = `FFmpeg exited (code ${code}). ${this.stderrTail.split('\n').filter((l) => /error|invalid|not found|could not/i.test(l)).slice(-3).join(' | ')}`
        this.emit('status', { running: false, error: err })
      } else {
        this.emit('status', { running: false })
      }
    })
    proc.stdin!.on('error', () => {})

    if (settings.systemAudio) this.startSystemAudioPump()
    this.startSnapshots()
    this.pruneTimer = setInterval(() => this.prune(), 5000)
    this.startedAtMs = Date.now()
    this.newestSeg = this.segStartNumber - 1
    this.newestChangedAt = Date.now()
    this.watchTimer = setInterval(() => this.checkStall(), 2000)
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
    await this.dropBrokenTail()
    this.emit('status', { running: false })
  }

  /**
   * Ending FFmpeg mid-segment (always the case with system audio, since it is killed) can leave the
   * newest segment unreadable. One bad file makes every later clip export stop at it, cutting off
   * whatever was recorded after a pause or restart, so remove it. Costs at most the last 2 s.
   */
  private async dropBrokenTail() {
    const segs = this.listSegments()
    const last = segs[segs.length - 1]
    if (!last) return
    const r = await run(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', last.file], { timeoutMs: 5000 })
    const dur = parseFloat(r.stdout)
    if (r.code !== 0 || !(dur > 0.2)) {
      try { fs.unlinkSync(last.file) } catch { /* already gone */ }
    }
  }

  private cleanup() {
    this.running = false
    this.proc = null
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    if (this.watchTimer) clearInterval(this.watchTimer)
    this.watchTimer = null
    if (this.sysTimer) clearInterval(this.sysTimer)
    if (this.snapTimer) clearInterval(this.snapTimer)
    this.snapTimer = null
    this.pruneTimer = this.sysTimer = null
    this.sysQueue = []
    for (const a of this.appSources.values()) a.stop()
    this.appSources.clear()
    if (this.appLevelTimer) clearInterval(this.appLevelTimer)
    this.appLevelTimer = null
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

  private snapTimer: NodeJS.Timeout | null = null
  private snapBusy = false

  /**
   * AI screen watching: every few seconds, decode the first frame (a keyframe) of the newest finished
   * segment, downscaled, in its own process. Costs one tiny decode per interval and can never slow
   * the recording. Frames are ~2-4 s behind live, which the clip's lead-in time already covers.
   */
  private startSnapshots() {
    if (this.snapTimer) clearInterval(this.snapTimer)
    this.snapTimer = null
    if (!this.snapshotsEnabled) return
    this.snapTimer = setInterval(() => void this.takeSnapshot(), Math.max(1, this.snapshotIntervalSec) * 1000)
  }

  private lastSnapSeg = -1
  private async takeSnapshot() {
    if (this.snapBusy || !this.running) return
    const segs = this.listSegments()
    const seg = segs[segs.length - 2]
    if (!seg || seg.n === this.lastSnapSeg) return
    this.snapBusy = true
    this.lastSnapSeg = seg.n
    try {
      const jpeg = await new Promise<Buffer | null>((resolve) => {
        const p = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-skip_frame', 'nokey', '-i', seg.file, '-frames:v', '1', '-vf', 'scale=1024:-2:out_range=full,format=yuvj420p', '-q:v', '6', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], { windowsHide: true })
        lowerPriority(p.pid)
        const chunks: Buffer[] = []
        p.stdout.on('data', (c: Buffer) => chunks.push(c))
        p.on('error', () => resolve(null))
        p.on('exit', (code) => resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null))
        setTimeout(() => p.kill(), 8000)
      })
      if (jpeg && this.running) this.emit('snapshot', jpeg)
    } finally {
      this.snapBusy = false
    }
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

    // Inputs: one dshow input per enabled mic, plus system audio on stdin.
    const inputs: string[] = []
    const sources = (s.audioSources ?? []).filter((x) => x.enabled && !this.missingSources.includes(x.id) && (x.kind === 'desktop' || (x.kind === 'app' ? this.appSources.has(x.id) : !!x.device)))
    const srcInput: { src: (typeof sources)[number]; idx: number }[] = []
    for (const src of sources) {
      if (src.kind !== 'mic') continue
      srcInput.push({ src, idx: srcInput.length })
      // Small capture buffer: by default DirectShow hands over mic audio in ~0.5 s chunks, and FFmpeg
      // holds the screen capture back while it waits for audio to keep the streams in step, so the
      // picture froze ~0.4 s every second. 20 ms chunks keep audio and video moving together.
      inputs.push('-f', 'dshow', '-audio_buffer_size', '20', '-rtbufsize', '64M', '-thread_queue_size', '2048', '-i', `audio=${src.device}`)
    }
    const desktop = sources.find((x) => x.kind === 'desktop')
    if (desktop) {
      srcInput.push({ src: desktop, idx: srcInput.length })
      inputs.push('-f', 's16le', '-ar', String(SYS_RATE), '-ac', String(SYS_CHANNELS), '-thread_queue_size', '2048', '-i', 'pipe:0')
    }
    for (const src of sources.filter((x) => x.kind === 'app')) {
      srcInput.push({ src, idx: srcInput.length })
      inputs.push('-f', 's16le', '-ar', String(SYS_RATE), '-ac', String(SYS_CHANNELS), '-thread_queue_size', '2048', '-i', this.appSources.get(src.id)!.pipePath)
    }
    this.triggerIds = sources.filter((x) => x.kind === 'mic' && x.trigger !== false).map((x) => x.id)
    this.sourceLevels = {}
    args.push(...inputs)

    // Filter graph
    const crop = this.display.crop
    const cropArgs = crop ? `:offset_x=${crop.x}:offset_y=${crop.y}:video_size=${crop.w}x${crop.h}` : ''
    // A window (game window / chosen window) is captured directly with Windows Graphics Capture:
    // any monitor, follows the window, and nothing on top of it gets in. Otherwise the screen.
    const win = this.display.window
    const grab = win
      ? `gfxcapture=hwnd=${win.hwnd}:max_framerate=${s.fps}:capture_cursor=1:display_border=0:resize_mode=scale_aspect:width=-2:height=-2,fps=${s.fps}`
      : `ddagrab=output_idx=${this.display.outputIdx ?? s.monitorIndex}:framerate=${s.fps}:draw_mouse=1${cropArgs}`
    const scaleExpr = scale === 1 ? '' : `,scale=trunc(iw*${scale}/2)*2:trunc(ih*${scale}/2)*2`
    const parts: string[] = []
    // The screenshot branch only exists while AI watching is on; otherwise frames never leave the GPU
    // for anything but the encoder (NVENC at native res) and FFmpeg does no extra work.
    // Only the recording comes out of this process. Snapshots for AI screen watching used to be a
    // second, 1-frame-per-3-s output here, and FFmpeg's scheduler held the video back to keep the two
    // outputs in step: clips froze for ~1 s every 3 s. They now come from finished segments instead
    // (see startSnapshots), in a separate short-lived process.
    if (useD3D) {
      parts.push(`${grab},setpts=PTS-STARTPTS[v]`)
    } else {
      parts.push(`${grab},setpts=PTS-STARTPTS,hwdownload,format=bgra${scaleExpr},format=nv12[v]`)
    }

    // Video and audio get separate filter graphs. FFmpeg runs each graph on its own thread; in one
    // shared graph, system audio arriving in bursts (the pipe from a hidden window) stalled the
    // thread, ddagrab wasn't pulled, and clips froze for ~1 s every few seconds while sound played on.
    const videoParts = parts.splice(0)

    // Audio: each source -> resample/stereo/volume -> split into (mix, [own track], [meter]).
    // Every input is rebased to t=0 so dshow's clock (seconds since boot) lines up with the pipe and video.
    const mixLabels: string[] = []
    const tracks: { label: string; title: string }[] = []
    for (const { src, idx } of srcInput) {
      const tag = src.id.replace(/[^\w-]/g, '')
      // App audio is already inside game & voice chat audio, so by default it only gets its own track.
      const inMix = src.kind !== 'app' || !!src.inMix
      const ownTrack = src.ownTrack || src.kind === 'app'
      const outs = inMix ? [`[mx_${tag}]`] : []
      if (ownTrack) outs.push(`[tr_${tag}]`)
      const meter = src.kind === 'mic'
      if (meter) outs.push(`[me_${tag}]`)
      const vol = Math.max(0, Math.min(2, src.volume ?? 1)).toFixed(2)
      const pre = `[${idx}:a]asetpts=PTS-STARTPTS,aresample=48000:async=1000,aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol}`
      parts.push(outs.length > 1 ? `${pre},asplit=${outs.length}${outs.join('')}` : `${pre}${outs[0]}`)
      if (meter) parts.push(`[me_${tag}]asetnsamples=n=4800:p=0,astats=metadata=1:reset=1:measure_overall=RMS_level:measure_perchannel=none,ametadata@m_${tag}=mode=print:key=lavfi.astats.Overall.RMS_level:direct=1,anullsink`)
      if (inMix) mixLabels.push(`[mx_${tag}]`)
      if (ownTrack) tracks.push({ label: `[tr_${tag}]`, title: src.name })
    }
    let audioOut = ''
    if (mixLabels.length > 1) {
      parts.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=0:normalize=0[amix]`)
      audioOut = '[amix]'
    } else if (mixLabels.length === 1) {
      audioOut = mixLabels[0]
    }
    args.push('-filter_complex', videoParts.join(';'))
    if (parts.length) args.push('-filter_complex', parts.join(';'))

    // Segment output
    args.push('-map', '[v]')
    if (audioOut) {
      // Track 1 is always the mix (what every player plays); separate tracks follow it.
      args.push('-map', audioOut)
      for (const t of tracks) args.push('-map', t.label)
    }
    args.push(...this.encoderArgs(encoder, s))
    args.push('-force_key_frames', `expr:gte(t,n_forced*${SEG_SECONDS})`)
    if (audioOut) {
      args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000')
      this.trackTitles = ['Mix', ...tracks.map((t) => t.title)]
      args.push('-metadata:s:a:0', 'title=Mix')
      tracks.forEach((t, i) => args.push(`-metadata:s:a:${i + 1}`, `title=${t.title.replace(/[\r\n=]/g, ' ')}`))
    }
    args.push('-f', 'segment', '-segment_time', String(SEG_SECONDS), '-segment_format', 'mpegts', '-reset_timestamps', '1', '-segment_start_number', String(this.segStartNumber), path.join(this.segDir, 'seg%06d.ts'))


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

  /** What FFmpeg last said on stderr (for stall reports). */
  get lastStderr() {
    return this.stderrTail
  }

  /**
   * A recorder that is alive but not finishing segments (an input that went quiet, a capture
   * source that died) looks healthy from the outside while nothing can be clipped: the newest
   * segment just grows. Flag it so the recorder restarts.
   */
  private checkStall() {
    if (!this.running || this.stopping) return
    const n = this.listSegments().reduce((m, sg) => Math.max(m, sg.n), -1)
    if (n !== this.newestSeg) { this.newestSeg = n; this.newestChangedAt = Date.now(); return }
    if (Date.now() - this.startedAtMs > STALL_MS + 4000 && Date.now() - this.newestChangedAt > STALL_MS) {
      this.newestChangedAt = Date.now() // one report per stall
      this.emit('stall', { seconds: Math.round(STALL_MS / 1000), stderr: this.stderrTail })
    }
  }

  private prune() {
    if (!this.settings) return
    const normal = Date.now() - (this.settings.bufferSeconds + 10) * 1000
    let keepAfter = this.holdFromMs === null ? normal : Math.min(normal, this.holdFromMs - SEG_SECONDS * 2000)
    // Saves in progress need their segments a little longer, but pruning must never stop
    // altogether: a save that hangs would let the buffer folder grow without limit.
    if (this.pendingHolds.length) keepAfter = Math.min(keepAfter, Math.min(...this.pendingHolds) - SEG_SECONDS * 2000)
    for (const seg of this.listSegments()) {
      if (seg.birthMs < keepAfter) {
        try { fs.unlinkSync(seg.file) } catch { /* in use */ }
      }
    }
  }

  /**
   * Write a small JPEG of the newest finished segment's first frame: a preview of exactly what is in
   * the recording (crop, scale and all), a couple of seconds behind live.
   */
  async previewFrame(outFile: string): Promise<{ ok: boolean; atMs: number }> {
    const segs = this.listSegments()
    const seg = this.running ? segs[segs.length - 2] : segs[segs.length - 1]
    if (!seg) return { ok: false, atMs: 0 }
    try { fs.unlinkSync(outFile) } catch { /* none yet */ }
    const r = await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', seg.file, '-frames:v', '1', '-vf', 'scale=480:-2:out_range=full,format=yuvj420p', '-q:v', '5', outFile], { timeoutMs: 8000 })
    return { ok: r.code === 0 && fs.existsSync(outFile), atMs: seg.birthMs }
  }

  /** Turn AI snapshots on or off while recording. */
  setSnapshots(on: boolean) {
    this.snapshotsEnabled = on
    if (this.running) this.startSnapshots()
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
    // While paused FFmpeg is stopped, but every segment on disk is complete and can be saved.
    const live = this.running
    if (!live && !req.allowStopped) throw new Error('Replay buffer is not running')
    this.pendingSaves++
    this.pendingHolds.push(req.startMs)
    try {
      const readyAt = req.endMs + (SEG_SECONDS + 0.75) * 1000
      if (live && Date.now() < readyAt) await new Promise((r) => setTimeout(r, readyAt - Date.now()))
      if (live && !this.running) throw new Error('Replay buffer stopped while saving')

      const segs = this.listSegments()
      // The newest segment is still being written while recording.
      const last = live ? segs[segs.length - 1] : undefined
      const chosen = segs.filter((sg) => sg !== last && sg.birthMs + SEG_SECONDS * 1000 > req.startMs && sg.birthMs < req.endMs)
      if (!chosen.length) throw new Error('No buffered video covers that range yet')

      const listFile = path.join(this.segDir, `clip-${Date.now()}.txt`)
      fs.writeFileSync(listFile, chosen.map((sg) => `file '${sg.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
      // Every segment starts on a keyframe. Seeking into the middle of one with stream copy gives a
      // clip whose first seconds have sound but no picture, so start on the segment boundary instead.
      const offsetSec = Math.floor(Math.max(0, (req.startMs - chosen[0].birthMs) / 1000) / SEG_SECONDS) * SEG_SECONDS
      // Measured from where the clip really starts, so the end of the range is not cut off.
      const durationSec = (req.endMs - (chosen[0].birthMs + offsetSec * 1000)) / 1000
      fs.mkdirSync(path.dirname(req.outFile), { recursive: true })
      const r = await run(ffmpegPath(), [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', offsetSec.toFixed(2), '-f', 'concat', '-safe', '0', '-i', listFile,
        '-t', durationSec.toFixed(2), '-map', '0', '-c', 'copy', ...this.trackTitles.flatMap((t, i) => [`-metadata:s:a:${i}`, `title=${t}`, `-metadata:s:a:${i}`, `handler_name=${t}`]), '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', req.outFile
      ], { timeoutMs: 120_000 })
      try { fs.unlinkSync(listFile) } catch { /* ignore */ }
      if (r.code !== 0 || !fs.existsSync(req.outFile)) throw new Error(`Clip export failed: ${r.stderr.trim().split('\n').pop()}`)
      const actualStartMs = chosen[0].birthMs + Math.floor(offsetSec / SEG_SECONDS) * SEG_SECONDS * 1000
      return { file: req.outFile, actualStartMs }
    } finally {
      this.pendingSaves--
      this.pendingHolds.splice(this.pendingHolds.indexOf(req.startMs), 1)
    }
  }
}
