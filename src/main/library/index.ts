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
  /** Include trashed clips (only). */
  trashed?: boolean
}

export interface AddMeta {
  game: string
  gameProcess?: string
  gameIcon?: string
  trigger: TriggerSource
  event?: string
  title?: string
  tags?: string[]
  hypeDb?: number
  bookmarks?: number[]
}

/** JSON-backed clip index. One folder of mp4s + thumbnails, one index file, optional trash folder. */
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
    return this.clips.filter((c) => !c.trashedAt)
  }

  get(id: string): Clip | undefined {
    return this.clips.find((c) => c.id === id)
  }

  games(): { name: string; process?: string; icon?: string; count: number }[] {
    const map = new Map<string, { name: string; process?: string; icon?: string; count: number }>()
    for (const c of this.all()) {
      const e = map.get(c.game) ?? { name: c.game, process: c.gameProcess, icon: c.gameIcon, count: 0 }
      e.count++
      if (!e.icon && c.gameIcon) e.icon = c.gameIcon
      map.set(c.game, e)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  }

  tags(): string[] {
    return [...new Set(this.all().flatMap((c) => c.tags))].sort()
  }

  query(q: LibraryQuery): Clip[] {
    let out = this.clips.filter((c) => (q.trashed ? !!c.trashedAt : !c.trashedAt) && fs.existsSync(c.file))
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
  async add(file: string, meta: AddMeta): Promise<Clip> {
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
      gameProcess: meta.gameProcess,
      gameIcon: meta.gameIcon,
      title: meta.title || meta.event || defaultTitle(meta.trigger),
      trigger: meta.trigger,
      event: meta.event,
      tags: meta.tags ?? [],
      favorite: false,
      hypeDb: meta.hypeDb,
      bookmarks: meta.bookmarks,
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

  markViewed(id: string) {
    const c = this.get(id)
    if (!c) return
    c.views = (c.views ?? 0) + 1
    this.save()
  }

  markPosted(id: string) {
    const c = this.get(id)
    if (!c) return
    c.discordPosts = [...(c.discordPosts ?? []), new Date().toISOString()]
    this.save()
  }

  bulk(ids: string[], patch: { favorite?: boolean; addTags?: string[] }) {
    for (const id of ids) {
      const c = this.get(id)
      if (!c) continue
      if (patch.favorite !== undefined) c.favorite = patch.favorite
      if (patch.addTags) c.tags = [...new Set([...c.tags, ...patch.addTags])]
    }
    this.save()
  }

  /** Move the file into <clips>/.trash so it can be restored. */
  trash(id: string): Clip | undefined {
    const c = this.get(id)
    if (!c || c.trashedAt) return
    const trashDir = path.join(path.dirname(path.dirname(c.file)), '.trash')
    try {
      fs.mkdirSync(trashDir, { recursive: true })
      const dest = path.join(trashDir, path.basename(c.file))
      fs.renameSync(c.file, dest)
      c.file = dest
    } catch {
      /* file already gone; keep index consistent */
    }
    c.trashedAt = new Date().toISOString()
    this.save()
    return c
  }

  restore(id: string): Clip | undefined {
    const c = this.get(id)
    if (!c || !c.trashedAt) return
    const safeGame = c.game.replace(/[^\w\- ]+/g, '').trim() || 'Clip'
    const dest = path.join(path.dirname(path.dirname(c.file)), safeGame, path.basename(c.file))
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.renameSync(c.file, dest)
      c.file = dest
    } catch {
      /* leave in place */
    }
    delete c.trashedAt
    this.save()
    return c
  }

  /** Permanently delete (used for emptying the trash and when the trash is disabled). */
  remove(id: string) {
    const c = this.get(id)
    if (!c) return
    this.clips = this.clips.filter((x) => x.id !== id)
    try { fs.unlinkSync(c.file) } catch { /* ignore */ }
    try { fs.unlinkSync(c.thumbnail) } catch { /* ignore */ }
    this.save()
  }

  emptyTrash() {
    for (const c of this.clips.filter((x) => x.trashedAt)) this.remove(c.id)
  }

  /** Drop index entries whose files were deleted outside the app; purge trash older than 30 days. */
  reconcile() {
    const before = this.clips.length
    const cutoff = Date.now() - 30 * 86400_000
    for (const c of this.clips.filter((x) => x.trashedAt && Date.parse(x.trashedAt) < cutoff)) this.remove(c.id)
    this.clips = this.clips.filter((c) => fs.existsSync(c.file))
    if (this.clips.length !== before) this.save()
  }

  stats() {
    const live = this.all()
    return { count: live.length, bytes: live.reduce((n, c) => n + c.sizeBytes, 0), seconds: live.reduce((n, c) => n + c.durationSec, 0), trashed: this.clips.filter((c) => c.trashedAt).length }
  }
}

function defaultTitle(trigger: TriggerSource): string {
  const d = new Date()
  const stamp = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return { hotkey: 'Clip', vision: 'Auto clip', voice: 'Voice chat', hype: 'Hype moment', manual: 'Clip', long: 'Long recording' }[trigger] + ' ' + stamp
}
