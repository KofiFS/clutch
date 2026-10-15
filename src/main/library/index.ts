import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Clip, TriggerSource } from '../../shared/types'
import { cleanGameName } from '../../shared/types'
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
  /** 'clutch' = recorded by Clutch, otherwise a LibrarySource id. Unset = everything. */
  source?: string
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

/**
 * JSON-backed clip index. Clutch's own clips live in its clips folder (with a trash folder);
 * clips from other libraries (Medal, any folder) are listed in place and are never deleted,
 * moved or shrunk: deleting one only hides it from Clutch.
 */
export class Library extends EventEmitter<{ change: [] }> {
  private clips: Clip[] = []
  private indexFile: string
  private hiddenFile: string
  private thumbDir: string
  /** Files from other libraries the user removed from Clutch, so a rescan doesn't bring them back. */
  private hidden = new Set<string>()
  private saveTimer: NodeJS.Timeout | null = null

  constructor(private dataDir: string) {
    super()
    this.indexFile = path.join(dataDir, 'clips.json')
    this.hiddenFile = path.join(dataDir, 'hidden-external.json')
    this.thumbDir = path.join(dataDir, 'thumbnails')
    fs.mkdirSync(this.thumbDir, { recursive: true })
    try {
      this.clips = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'))
    } catch {
      this.clips = []
    }
    // Older clips may carry a raw window title as the game ("Rocket League (64-bit, DX11, Cooked)").
    let renamed = false
    for (const c of this.clips) { const g = cleanGameName(c.game); if (g !== c.game) { c.game = g; renamed = true } }
    if (renamed) try { fs.writeFileSync(this.indexFile, JSON.stringify(this.clips, null, 2)) } catch { /* next save writes it */ }
    try {
      this.hidden = new Set((JSON.parse(fs.readFileSync(this.hiddenFile, 'utf8')) as string[]).map(fileKey))
    } catch { /* none hidden yet */ }
  }

  private save() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
    fs.writeFileSync(this.indexFile, JSON.stringify(this.clips, null, 2))
    this.emit('change')
  }

  /** Coalesce many saves (a library scan adds clips one by one). */
  private saveSoon() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => this.save(), 1500)
  }

  /** Clips recorded by Clutch itself (the only ones storage rules may delete or shrink). */
  own(): Clip[] {
    return this.clips.filter((c) => !c.source)
  }

  /** Is this clip from another library (read in place, never deleted by Clutch)? */
  isExternal(c: Clip): boolean {
    return !!c.source
  }

  // ---------------- other libraries ----------------

  /** Files of a library that are already listed (or hidden), to skip on rescan. */
  knownFiles(source: string): Set<string> {
    return new Set([...this.clips.filter((c) => c.source === source).map((c) => fileKey(c.file)), ...this.hidden])
  }

  bySource(source: string): Clip[] {
    return this.clips.filter((c) => c.source === source)
  }

  /** List a video from another library. The file stays where it is. */
  async addExternal(file: string, source: string, meta: { game: string; createdAt: string; title: string }): Promise<Clip | null> {
    const info = await probe(file)
    if (!info.durationSec || info.durationSec < 0.5) return null
    const id = randomUUID()
    const thumbnail = path.join(this.thumbDir, `${id}.jpg`)
    await makeThumbnail(file, thumbnail, Math.min(2, Math.max(0, info.durationSec / 3))).catch(() => undefined)
    const clip: Clip = {
      id, file, thumbnail, source,
      createdAt: meta.createdAt,
      durationSec: info.durationSec,
      sizeBytes: fs.statSync(file).size,
      game: meta.game || 'Unknown',
      title: meta.title,
      trigger: 'manual',
      tags: [],
      favorite: false,
      width: info.width,
      height: info.height,
      fps: info.fps,
      uploads: []
    }
    this.clips.push(clip)
    this.saveSoon()
    return clip
  }

  /** Forget a library: its clips leave Clutch, the files are untouched. */
  removeSource(source: string, root: string) {
    for (const c of this.clips.filter((x) => x.source === source)) this.dropThumbs(c)
    this.clips = this.clips.filter((c) => c.source !== source)
    const prefix = fileKey(root).replace(/[\\/]+$/, '') + path.sep
    this.hidden = new Set([...this.hidden].filter((f) => !f.startsWith(prefix)))
    try { fs.writeFileSync(this.hiddenFile, JSON.stringify([...this.hidden])) } catch { /* best effort */ }
    this.save()
  }

  /** Drop listed files of a library that no longer exist on disk. */
  pruneSource(source: string) {
    const before = this.clips.length
    this.clips = this.clips.filter((c) => c.source !== source || fs.existsSync(c.file))
    if (this.clips.length !== before) this.save()
  }

  private hide(c: Clip) {
    this.hidden.add(fileKey(c.file))
    try { fs.writeFileSync(this.hiddenFile, JSON.stringify([...this.hidden])) } catch { /* best effort */ }
  }

  private dropThumbs(c: Clip) {
    try { fs.unlinkSync(c.thumbnail) } catch { /* ignore */ }
    try { fs.unlinkSync(c.thumbnail.replace(/\.jpg$/i, '') + '.wave.json') } catch { /* no waveform cached */ }
  }

  all(): Clip[] {
    return this.clips.filter((c) => !c.trashedAt)
  }

  /** Every clip including the trash (for storage limits). */
  everything(): Clip[] {
    return [...this.clips]
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
    if (q.source) out = out.filter((c) => (q.source === 'clutch' ? !c.source : c.source === q.source))
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

  update(id: string, patch: Partial<Pick<Clip, 'title' | 'tags' | 'favorite' | 'game' | 'uploads' | 'cloud' | 'sizeBytes' | 'shrunk'>>): Clip | undefined {
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

  /** Move the file into <clips>/.trash so it can be restored. Another library's video is only hidden. */
  trash(id: string): Clip | undefined {
    const c = this.get(id)
    if (!c || c.trashedAt) return
    if (c.source) { this.remove(id); return c }
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

  /**
   * Permanently delete (used for emptying the trash and when the trash is disabled).
   * Another library's video is never deleted: it is only hidden from Clutch.
   */
  remove(id: string) {
    const c = this.get(id)
    if (!c) return
    this.clips = this.clips.filter((x) => x.id !== id)
    if (c.source) {
      this.hide(c)
      this.dropThumbs(c)
      this.save()
      return
    }
    try { fs.unlinkSync(c.file) } catch { /* ignore */ }
    try { fs.unlinkSync(c.thumbnail) } catch { /* ignore */ }
    try { fs.unlinkSync(c.thumbnail.replace(/\.jpg$/i, '') + '.wave.json') } catch { /* no waveform cached */ }
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
    // Other libraries are pruned by their own scan, which knows whether the folder is reachable
    // (an unplugged drive must not wipe the list, favorites and titles).
    this.clips = this.clips.filter((c) => c.source || fs.existsSync(c.file))
    if (this.clips.length !== before) this.save()
  }

  /** Clutch's own clips (what its storage rules and "On disk" are about). */
  stats() {
    const live = this.all().filter((c) => !c.source)
    return { count: live.length, bytes: live.reduce((n, c) => n + c.sizeBytes, 0), seconds: live.reduce((n, c) => n + c.durationSec, 0), trashed: this.clips.filter((c) => c.trashedAt).length }
  }
}

/**
 * Folder for a new file made from a clip (trim, edit, join). Clutch's own clips: next to the
 * clip. Another library's video: Clutch's clips folder, so Clutch never writes into Medal's folder.
 */
export function outputDirFor(clip: Clip, ownDir: string): string {
  const dir = clip.source ? path.join(ownDir, clip.game.replace(/[^\w\- ]+/g, '').trim() || 'Clip') : path.dirname(clip.file)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** A clip's file name without its extension (.mp4, .mkv, .mov…). */
export function baseName(file: string): string {
  return path.basename(file).replace(/\.[^.]+$/, '')
}

/** Comparable file path (Windows paths are case-insensitive). */
export function fileKey(file: string): string {
  return path.normalize(file).toLowerCase()
}

function defaultTitle(trigger: TriggerSource): string {
  const d = new Date()
  const stamp = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return { hotkey: 'Clip', vision: 'Auto clip', voice: 'Voice chat', hype: 'Hype moment', manual: 'Clip', long: 'Long recording' }[trigger] + ' ' + stamp
}
