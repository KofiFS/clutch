import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import type { Clip, Settings, ShrinkProgress } from '../../shared/types'
import { detectEncoders, ffmpegPath, ffprobePath, lowerPriority, run } from '../capture/ffmpeg'
import type { Library } from './index'

/**
 * Storage saver: re-encodes clips to AV1 (or HEVC on GPUs without AV1) in the background, which
 * on real 5120x1440 gameplay kept the same visible quality (VMAF ~93) at about a quarter of the
 * size. Only while Clutch isn't recording, below normal priority, one clip at a time; stops the
 * moment recording starts. Sharing and exporting still produce plain H.264 MP4s that play
 * everywhere (makeShareable / exportCompatible), so nobody downstream ever sees AV1.
 *
 * Automatic shrinking only touches clips recorded after it was turned on; "Shrink my existing
 * clips" opts the rest in. Favorites included (it's the same picture, smaller).
 */
export class Compressor extends EventEmitter<{ progress: [ShrinkProgress] }> {
  private timer: NodeJS.Timeout | null = null
  private active: { clipId: string; proc: ReturnType<typeof spawn> } | null = null
  private includeExisting = false
  progress: ShrinkProgress = { running: false, done: 0, total: 0, savedBytes: 0 }

  constructor(private lib: Library, private settings: () => Settings, private busy: () => boolean, private log: (m: string) => void) {
    super()
  }

  start() {
    this.timer = setInterval(() => void this.tick(), 60_000)
    setTimeout(() => void this.tick(), 20_000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.active?.proc.kill()
  }

  /** Clips waiting to be shrunk (respects "after N days" and the opt-in date). */
  candidates(all = this.includeExisting): Clip[] {
    const st = this.settings().storage
    const days = st.shrinkAfterDays ?? 1
    const since = st.shrinkSince ?? Date.now()
    const cutoff = Date.now() - Math.max(0, days) * 86400_000
    return this.lib.all()
      .filter((c) => !c.source && !c.shrunk && (c.sizeBytes || 0) > 5 * 1024 ** 2 && Date.parse(c.createdAt) <= cutoff && (all || Date.parse(c.createdAt) >= since))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  }

  /** "Shrink my existing clips": include clips from before shrinking was turned on. */
  shrinkExisting() {
    this.includeExisting = true
    const list = this.candidates(true)
    this.set({ running: list.length > 0, done: 0, total: list.length, savedBytes: 0 })
    void this.tick()
  }

  /** Paused the moment recording starts (the GPU belongs to the game and the recorder). */
  pauseForRecording() {
    if (this.active) {
      this.active.proc.kill()
      this.active = null
    }
  }

  private set(p: Partial<ShrinkProgress>) {
    this.progress = { ...this.progress, ...p }
    this.emit('progress', this.progress)
  }

  private async tick() {
    if (this.active || this.busy()) return
    const st = this.settings().storage
    if (!this.includeExisting && (st.shrink ?? 'auto') === 'off') return
    const next = this.candidates()[0]
    if (!next) {
      if (this.progress.running) this.set({ running: false })
      this.includeExisting = false
      return
    }
    if (!this.progress.running) this.set({ running: true, total: this.candidates().length, done: 0 })
    const ok = await this.shrink(next).catch((e) => { this.log(`Could not shrink "${next.title}": ${e instanceof Error ? e.message : String(e)}`); return false })
    if (ok) this.set({ done: this.progress.done + 1 })
    // Keep going while idle; each clip takes seconds to a minute on the GPU.
    if (!this.busy()) setTimeout(() => void this.tick(), 1500)
  }

  private async encoderArgs(): Promise<string[] | null> {
    const enc = await detectEncoders()
    if (enc.available.includes('av1_nvenc')) return ['-c:v', 'av1_nvenc', '-preset', 'p6', '-tune', 'hq', '-multipass', 'fullres', '-rc', 'vbr', '-cq', '34', '-b:v', '0', '-rc-lookahead', '32']
    if (enc.available.includes('hevc_nvenc')) return ['-c:v', 'hevc_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', '28', '-b:v', '0']
    return null // CPU-only PCs: software AV1/HEVC would take far too long, so leave clips as they are
  }

  private async codecOf(file: string): Promise<string> {
    const r = await run(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file])
    return r.stdout.trim()
  }

  private async shrink(clip: Clip): Promise<boolean> {
    const args = await this.encoderArgs()
    if (!args) { this.lib.update(clip.id, { shrunk: { codec: 'skipped', fromBytes: clip.sizeBytes, at: new Date().toISOString() } }); return false }
    if ((await this.codecOf(clip.file)) === 'av1') { this.lib.update(clip.id, { shrunk: { codec: 'av1', fromBytes: clip.sizeBytes, at: new Date().toISOString() } }); return false }
    const tmp = clip.file.replace(/\.mp4$/i, '') + '.shrinking.mp4'
    const before = fs.statSync(clip.file).size
    // Keep the audio track names (Mix, Microphone, Discord...) that editors show.
    const names = (await run(ffprobePath(), ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream_tags=handler_name,title', '-of', 'csv=p=0', clip.file])).stdout
      .trim().split(/\r?\n/).map((l) => l.split(',').filter(Boolean).pop() ?? '')
    const trackMeta = names.flatMap((n, i) => (n && n !== 'SoundHandler' ? [`-metadata:s:a:${i}`, `title=${n}`, `-metadata:s:a:${i}`, `handler_name=${n}`] : []))
    const proc = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', clip.file, '-map', '0', ...args, '-c:a', 'copy', '-map_metadata', '0', ...trackMeta, '-movflags', '+faststart', tmp], { windowsHide: true })
    lowerPriority(proc.pid)
    this.active = { clipId: clip.id, proc }
    const code = await new Promise<number | null>((r) => proc.on('exit', r))
    this.active = null
    const cleanup = () => { try { fs.unlinkSync(tmp) } catch { /* none */ } }
    if (code !== 0 || !fs.existsSync(tmp)) { cleanup(); return false } // stopped for recording, or failed: try later
    // Only keep it if it is really smaller and the same length.
    const after = fs.statSync(tmp).size
    const dur = Number((await run(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp])).stdout.trim())
    if (!(after < before * 0.9) || Math.abs(dur - clip.durationSec) > 1) {
      cleanup()
      this.lib.update(clip.id, { shrunk: { codec: 'kept-original', fromBytes: before, at: new Date().toISOString() } })
      return false
    }
    try {
      fs.renameSync(tmp, clip.file) // replaces the original (fails while the clip is open: retried later)
    } catch {
      cleanup()
      return false
    }
    this.lib.update(clip.id, { sizeBytes: after, shrunk: { codec: args[1].startsWith('av1') ? 'av1' : 'hevc', fromBytes: before, at: new Date().toISOString() } })
    this.set({ savedBytes: this.progress.savedBytes + (before - after) })
    return true
  }
}
