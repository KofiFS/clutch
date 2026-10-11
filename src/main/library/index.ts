import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Clip, TriggerSource } from '../../shared/types'
import { makeThumbnail, probe } from '../capture/ffmpeg'

export interface LibraryQuery {
  text?: string
  game?: string
  trigger?: TriggerSource | 'all'
  favoritesOnly?: boolean
  tag?: string
  sort?: 'newest' | 'oldest' | 'longest' | 'largest'
}

/** JSON-backed clip index. One folder of mp4s + thumbnails, one index file. */
export class Library extends EventEmitter<{ change: [] }> {
  private clips: Clip[] = []
  private indexFile: string
  private thumbDir: string

  constructor(private dataDir: string) {
    super()
    this.indexFile = path.join(dataDir, 'clips.json')
    this.thumbDir = path.join(dataDir, 'thumbnails')
    fs.mkdirSync(this.thumbDir, { recursive: true })
    try {
      this.clips = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'))
    } catch {
      this.clips = []
    }
  }

  private save() {
    fs.writeFileSync(this.indexFile, JSON.stringify(this.clips, null, 2))
    this.emit('change')
  }

  all(): Clip[] {
    return this.clips
  }

  get(id: string): Clip | undefined {
    return this.clips.find((c) => c.id === id)
  }

  games(): string[] {
    return [...new Set(this.clips.map((c) => c.game))].sort()
  }

  tags(): string[] {
    return [...new Set(this.clips.flatMap((c) => c.tags))].sort()
  }

  query(q: LibraryQuery): Clip[] {
    let out = this.clips.filter((c) => fs.existsSync(c.file))
    if (q.game) out = out.filter((c) => c.game === q.game)
    if (q.trigger && q.trigger !== 'all') out = out.filter((c) => c.trigger === q.trigger)
    if (q.favoritesOnly) out = out.filter((c) => c.favorite)
    if (q.tag) out = out.filter((c) => c.tags.includes(q.tag!))
    if (q.text) {
      const t = q.text.toLowerCase()
      out = out.filter((c) => [c.title, c.game, c.event ?? '', ...c.tags].join(' ').toLowerCase().includes(t))
    }
    const sorters: Record<string, (a: Clip, b: Clip) => number> = {
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
      longest: (a, b) => b.durationSec - a.durationSec,
      largest: (a, b) => b.sizeBytes - a.sizeBytes
    }
    return out.sort(sorters[q.sort ?? 'newest'])
  }

  /** Register a freshly exported mp4: probe it, build a thumbnail, add to the index. */
  async add(file: string, meta: { game: string; trigger: TriggerSource; event?: string; title?: string; tags?: string[] }): Promise<Clip> {
    const id = randomUUID()
    const info = await probe(file)
    const thumbnail = path.join(this.thumbDir, `${id}.jpg`)
    await makeThumbnail(file, thumbnail, Math.min(1, Math.max(0, info.durationSec / 2)))
    const clip: Clip = {
      id,
      file,
      thumbnail,
      createdAt: new Date().toISOString(),
      durationSec: info.durationSec,
      sizeBytes: fs.statSync(file).size,
      game: meta.game || 'Unknown',
      title: meta.title || meta.event || defaultTitle(meta.trigger),
      trigger: meta.trigger,
      event: meta.event,
      tags: meta.tags ?? [],
      favorite: false,
      width: info.width,
      height: info.height,
      fps: info.fps,
      uploads: []
    }
    this.clips.unshift(clip)
    this.save()
    return clip
  }

  update(id: string, patch: Partial<Pick<Clip, 'title' | 'tags' | 'favorite' | 'game' | 'uploads'>>): Clip | undefined {
    const c = this.get(id)
    if (!c) return
    Object.assign(c, patch)
    this.save()
    return c
  }

  remove(id: string, deleteFile = true) {
    const c = this.get(id)
    if (!c) return
    this.clips = this.clips.filter((x) => x.id !== id)
    if (deleteFile) {
      try { fs.unlinkSync(c.file) } catch { /* ignore */ }
    }
    try { fs.unlinkSync(c.thumbnail) } catch { /* ignore */ }
    this.save()
  }

  /** Drop index entries whose files were deleted outside the app. */
  reconcile() {
    const before = this.clips.length
    this.clips = this.clips.filter((c) => fs.existsSync(c.file))
    if (this.clips.length !== before) this.save()
  }
}

function defaultTitle(trigger: TriggerSource): string {
  const d = new Date()
  const stamp = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return { hotkey: 'Clip', vision: 'Auto clip', voice: 'Voice chat', manual: 'Clip' }[trigger] + ' ' + stamp
}
