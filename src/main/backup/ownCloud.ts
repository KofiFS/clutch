import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { Clip, OwnCloudSettings, OwnCloudState } from '../../shared/types'
import type { Library } from '../library'

interface Saved { path: string; size: number; at: string }

/**
 * "Save to my cloud": copies clips into a folder the user's own cloud app syncs (Google Drive,
 * OneDrive, Dropbox, iCloud, or any folder such as a NAS). The bytes go from this PC to the user's
 * own account through that app; Clutch and its servers never see them.
 *
 * Rules: copies only (the original stays where it is), never deletes or overwrites anything in the
 * cloud folder, one file at a time, and never while a recording is starting or running.
 * What has been copied is remembered in own-cloud.json (a new file, so older Clutch versions that
 * share the data folder are unaffected).
 */
export class OwnCloudBackup extends EventEmitter<{ change: [OwnCloudState]; log: [string] }> {
  private saved: Record<string, Saved> = {}
  private queue: string[] = []
  private busy = false
  private current: { clipId: string; title: string; progress: number } | null = null
  private lastError: string | undefined
  private timer: NodeJS.Timeout | null = null
  private file: string

  constructor(
    private library: Library,
    private settings: () => OwnCloudSettings,
    private isRecording: () => boolean,
    dataDir: string
  ) {
    super()
    this.file = path.join(dataDir, 'own-cloud.json')
    try { this.saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { this.saved = {} }
  }

  start() {
    this.library.on('change', () => this.scheduleScan())
    this.timer = setInterval(() => this.pump(), 20_000)
    this.timer.unref()
    this.scheduleScan()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  get state(): OwnCloudState {
    const s = this.settings()
    return {
      enabled: s.enabled && !!s.folder,
      folder: s.folder ? this.root() : '',
      queued: this.queue.length,
      current: this.current ?? undefined,
      savedCount: Object.keys(this.saved).length,
      lastError: this.lastError
    }
  }

  /** Where a clip was copied to, if it was (and the copy is still there). */
  savedFor(clipId: string): string | null {
    const r = this.saved[clipId]
    return r && exists(r.path) ? r.path : null
  }

  /** Queue clips by hand (the "Save to my cloud" button); works whatever the automatic mode is. */
  enqueue(ids: string[]): number {
    if (!this.settings().folder) throw new Error('Choose your cloud folder under Settings → Your cloud first')
    let n = 0
    for (const id of ids) {
      if (this.queue.includes(id) || this.savedFor(id)) continue
      if (!this.library.get(id)) continue
      this.queue.push(id)
      n++
    }
    this.emitState()
    this.pump()
    return n
  }

  /** The Clutch folder inside the chosen cloud folder. */
  root(): string {
    return path.join(this.settings().folder, 'Clutch')
  }

  private scanTimer: NodeJS.Timeout | null = null
  private scheduleScan() {
    if (this.scanTimer) return
    this.scanTimer = setTimeout(() => { this.scanTimer = null; this.scan() }, 3000)
  }

  /** Adds clips the automatic mode wants that are not copied yet. */
  private scan() {
    const s = this.settings()
    if (!s.enabled || !s.folder || s.mode === 'manual') return
    const since = s.enabledSince ?? 0
    const want = (c: Clip) => {
      if (c.trashedAt || c.source || this.saved[c.id] || this.queue.includes(c.id)) return false
      // Full-length recordings can be hours long: only copied when asked for.
      if (c.trigger === 'long') return false
      if (s.mode === 'favorites') return c.favorite
      return Date.parse(c.createdAt) >= since
    }
    const add = this.library.all().filter(want).map((c) => c.id)
    if (!add.length) return
    this.queue.push(...add)
    this.emitState()
    this.pump()
  }

  private pump(): void {
    if (this.busy || !this.queue.length || this.isRecording()) return
    if (!this.settings().folder) return
    const id = this.queue[0]
    const clip = this.library.get(id)
    if (!clip || !exists(clip.file)) { this.queue.shift(); this.emitState(); return this.pump() }
    this.busy = true
    void this.copy(clip)
      .then((dest) => {
        this.saved[clip.id] = { path: dest, size: fs.statSync(dest).size, at: new Date().toISOString() }
        this.persist()
        this.lastError = undefined
        this.emit('log', `Saved "${clip.title}" to your cloud folder`)
        this.queue.shift()
      })
      .catch((e: unknown) => {
        this.lastError = e instanceof Error ? e.message : String(e)
        this.emit('log', `Could not save "${clip.title}" to your cloud folder: ${this.lastError}`)
        // Move it to the back so one bad file does not block the rest; the 20 s timer retries.
        this.queue.push(this.queue.shift()!)
      })
      .finally(() => {
        this.busy = false
        this.current = null
        this.emitState()
        if (!this.lastError) this.pump()
      })
  }

  /** Copy to "<cloud>/Clutch/<Game>/<name>.mp4" through a .part file; never replaces an existing file. */
  private async copy(clip: Clip): Promise<string> {
    const dir = path.join(this.root(), safeName(clip.game) || 'Clips')
    await fs.promises.mkdir(dir, { recursive: true })
    const ext = path.extname(clip.file) || '.mp4'
    const base = safeName(path.basename(clip.file, ext)) || 'Clip'
    const size = (await fs.promises.stat(clip.file)).size
    let dest = path.join(dir, base + ext)
    for (let n = 2; exists(dest); n++) {
      if (fs.statSync(dest).size === size) return dest // already there (copied before, or by hand)
      dest = path.join(dir, `${base} (${n})${ext}`)
    }
    const part = dest + '.part'
    this.current = { clipId: clip.id, title: clip.title, progress: 0 }
    this.emitState()
    await new Promise<void>((resolve, reject) => {
      const src = fs.createReadStream(clip.file)
      const out = fs.createWriteStream(part, { flags: 'wx' })
      let done = 0
      let last = 0
      src.on('data', (chunk) => {
        done += chunk.length
        if (this.current && Date.now() - last > 250) { last = Date.now(); this.current.progress = done / size; this.emitState() }
      })
      src.on('error', reject)
      out.on('error', reject)
      out.on('finish', () => resolve())
      src.pipe(out)
    }).catch(async (e) => { await fs.promises.rm(part, { force: true }); throw e })
    await fs.promises.rename(part, dest)
    return dest
  }

  private persist() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.saved)) } catch { /* best effort */ }
  }

  private emitState() {
    this.emit('change', this.state)
  }
}

function exists(p: string): boolean {
  try { return fs.statSync(p).isFile() } catch { return false }
}

/** Windows-safe file or folder name. */
function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '').replace(/[. ]+$/, '').trim().slice(0, 120)
}
