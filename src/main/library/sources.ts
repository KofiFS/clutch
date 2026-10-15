import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LibraryInfo, LibrarySource } from '../../shared/types'
import { cleanGameName } from '../../shared/types'
import type { SettingsStore } from '../settings'
import { fileKey, type Library } from './index'

const VIDEO = /\.(mp4|mkv|mov|webm|avi)$/i
/** Folders inside a library that never hold clips (Medal's own scratch folders, trash). */
const SKIP_DIRS = /^(\.|\$|thumbnails$|temp$|tmp$|databases$|editor$|cache$)/i
/** Files still being written by the other app are skipped until they settle. */
const SETTLE_MS = 30_000
const MAX_DEPTH = 3

/**
 * Other clip libraries (Medal, OBS, NVIDIA, any folder) listed next to Clutch's clips. Videos are
 * read where they are: nothing is copied, moved, deleted or shrunk. A first-level subfolder is
 * taken as the game (Medal, OBS and NVIDIA all sort clips into per-game folders).
 */
export class LibrarySources extends EventEmitter<{ change: [LibraryInfo[]]; log: [string] }> {
  private scanning = new Map<string, { done: number; total: number }>()
  private queued = new Set<string>()

  constructor(private lib: Library, private settings: SettingsStore, private ownDir: () => string) {
    super()
  }

  sources(): LibrarySource[] {
    return this.settings.get().libraries ?? []
  }

  list(): LibraryInfo[] {
    return this.sources().map((s) => {
      const clips = this.lib.bySource(s.id).filter((c) => !c.trashedAt)
      return { ...s, count: clips.length, bytes: clips.reduce((n, c) => n + (c.sizeBytes || 0), 0), missing: !isDir(s.path), scanning: this.scanning.get(s.id) }
    })
  }

  /** Add a folder. Returns the new library, or throws a message the UI can show. */
  async add(dir: string, kind: LibrarySource['kind'] = 'folder'): Promise<LibraryInfo> {
    const folder = path.resolve(dir)
    if (!isDir(folder)) throw new Error("That folder doesn't exist or can't be opened.")
    const own = path.resolve(this.ownDir())
    if (inside(folder, own) || inside(own, folder)) throw new Error("That's Clutch's own clips folder (or contains it). Those clips are already here.")
    const clash = this.sources().find((s) => inside(folder, s.path) || inside(s.path, folder))
    if (clash) throw new Error(`That folder is already part of the "${clash.name}" library.`)
    const src: LibrarySource = {
      id: randomUUID(),
      name: kind === 'medal' ? 'Medal' : path.basename(folder) || folder,
      path: folder,
      kind,
      addedAt: new Date().toISOString()
    }
    this.settings.set({ libraries: [...this.sources(), src] })
    void this.scan(src.id)
    return this.list().find((l) => l.id === src.id)!
  }

  remove(id: string) {
    const src = this.sources().find((s) => s.id === id)
    if (!src) return
    this.settings.set({ libraries: this.sources().filter((s) => s.id !== id) })
    this.lib.removeSource(id, src.path)
    this.scanning.delete(id)
    this.changed()
  }

  rename(id: string, name: string) {
    const clean = name.trim().slice(0, 40)
    if (!clean) return
    this.settings.set({ libraries: this.sources().map((s) => (s.id === id ? { ...s, name: clean } : s)) })
    this.changed()
  }

  scanAll() {
    for (const s of this.sources()) void this.scan(s.id)
  }

  /** Find new videos (and forget deleted ones). Runs at low priority, two files at a time. */
  async scan(id: string): Promise<void> {
    if (this.scanning.has(id)) { this.queued.add(id); return }
    const src = this.sources().find((s) => s.id === id)
    if (!src) return
    if (!isDir(src.path)) { this.changed(); return } // unplugged drive: keep the list as it is
    const progress = { done: 0, total: 0 }
    this.scanning.set(id, progress)
    try {
      this.lib.pruneSource(id)
      const known = this.lib.knownFiles(id)
      const own = path.resolve(this.ownDir())
      const found = walk(src.path, own).filter((f) => !known.has(fileKey(f.file)))
      progress.total = found.length
      this.changed()
      let added = 0
      const work = [...found]
      const worker = async () => {
        for (let f = work.shift(); f; f = work.shift()) {
          if (!this.sources().some((s) => s.id === id)) return // removed while scanning
          try {
            const meta = describe(src, f.file, f.stat)
            if (await this.lib.addExternal(f.file, id, meta)) added++
          } catch { /* unreadable or broken video: skip it */ }
          progress.done++
          if (progress.done % 5 === 0 || progress.done === progress.total) this.changed()
        }
      }
      await Promise.all([worker(), worker()])
      if (added) this.emit('log', `Added ${added} video${added === 1 ? '' : 's'} from ${src.name}`)
    } finally {
      this.scanning.delete(id)
      this.changed()
      if (this.queued.delete(id)) void this.scan(id)
    }
  }

  private changed() {
    this.emit('change', this.list())
  }
}

/** Medal's clips folder on this PC, if Medal is installed and its folder exists. */
export async function detectMedal(): Promise<string | null> {
  const candidates: string[] = []
  // Medal stores its folder setting ("ClipFolder") in a SQLite file in %APPDATA%\Medal. Read a
  // copy, since Medal keeps the original open.
  try {
    const dir = path.join(process.env.APPDATA ?? '', 'Medal')
    const dbs = fs.readdirSync(dir).filter((f) => /^medal-\d+\.db$/i.test(f)).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    if (dbs[0]) {
      const tmp = path.join(os.tmpdir(), `clutch-medal-${process.pid}.db`)
      fs.copyFileSync(dbs[0], tmp)
      try {
        const { DatabaseSync } = await import('node:sqlite')
        const db = new DatabaseSync(tmp, { readOnly: true })
        const row = db.prepare("SELECT value FROM key_values WHERE key = 'ClipFolder'").get() as { value?: Uint8Array | string } | undefined
        db.close()
        const raw = typeof row?.value === 'string' ? row.value : row?.value ? Buffer.from(row.value).toString('latin1') : ''
        const m = raw.match(/[A-Za-z]:(?:\\\\|\\|\/)[^\x00-\x1f"]*/)
        if (m) candidates.push(m[0].replace(/\\\\/g, '\\'))
      } finally {
        try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      }
    }
  } catch { /* Medal not installed or its format changed: fall back to the defaults */ }
  candidates.push('C:\\Medal', path.join(os.homedir(), 'Videos', 'Medal'))
  for (const base of candidates) {
    for (const dir of [path.join(base, 'Clips'), base]) {
      if (isDir(dir) && walk(dir, '', 1).length + subdirs(dir).length > 0) return dir
    }
  }
  return null
}

function walk(root: string, skip: string, maxDepth = MAX_DEPTH): { file: string; stat: fs.Stats }[] {
  const out: { file: string; stat: fs.Stats }[] = []
  const now = Date.now()
  const visit = (dir: string, depth: number) => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.test(e.name) && !(skip && inside(full, skip))) visit(full, depth + 1)
      } else if (e.isFile() && VIDEO.test(e.name)) {
        try {
          const st = fs.statSync(full)
          if (st.size > 200 * 1024 && now - st.mtimeMs > SETTLE_MS) out.push({ file: full, stat: st })
        } catch { /* vanished */ }
      }
    }
  }
  visit(root, 0)
  return out
}

function subdirs(dir: string): string[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP_DIRS.test(e.name)).map((e) => e.name) } catch { return [] }
}

/** Game, date and title for a video, from where it sits and its name. */
function describe(src: LibrarySource, file: string, st: fs.Stats): { game: string; createdAt: string; title: string } {
  const rel = path.relative(src.path, file).split(path.sep)
  let game = cleanGameName(rel.length > 1 ? rel[0] : src.name)
  if (src.kind === 'medal' && /^screen recording$/i.test(game)) game = 'Desktop'
  // Medal names files MedalTV<Game><yyyyMMddHHmmssSSS>.mp4; other apps usually put a date in too.
  const base = path.basename(file).replace(/\.[^.]+$/, '')
  const d = base.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[ _T-]?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})/)
  let when = d ? new Date(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6]) : null
  if (!when || isNaN(when.getTime()) || when.getTime() > Date.now() + 86400_000) {
    const born = st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs
    when = new Date(born)
  }
  const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const autoNamed = /^medaltv/i.test(base) || /^\d[\d\s_.-]+$/.test(base) || /^(replay|clip|recording)[\s_-]?\d/i.test(base) || /20\d{2}[-_.]?\d{2}[-_.]?\d{2}/.test(base)
  // Game and date already show under the title, so an automatic name only adds the time.
  const title = autoNamed ? `${src.kind === 'medal' ? 'Medal clip' : `${src.name} clip`} · ${time}` : base.replace(/[_]+/g, ' ').trim()
  return { game, createdAt: when.toISOString(), title }
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}
