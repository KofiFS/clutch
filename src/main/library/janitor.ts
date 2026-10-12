import fs from 'node:fs'
import path from 'node:path'
import type { Clip, StorageRules } from '../../shared/types'
import type { Library } from './index'

const GB = 1024 ** 3

export interface JanitorResult {
  removed: number
  freedBytes: number
  reason: 'age' | 'size' | null
}

/** Free space on the drive holding `dir` (walks up to an existing folder). */
export function freeBytes(dir: string): number | null {
  let d = dir
  for (let i = 0; i < 10 && d; i++) {
    try {
      const st = fs.statfsSync(d)
      return Number(st.bavail) * Number(st.bsize)
    } catch {
      const up = path.dirname(d)
      if (up === d) break
      d = up
    }
  }
  return null
}

/**
 * Keeps the clip library from filling the drive (a top complaint about Medal):
 *  1. clips older than `deleteAfterDays` are deleted, favorites never;
 *  2. above `maxGB`, the trash is emptied first, then the oldest non-favorite clips go.
 * Long recordings count like any clip. Nothing a user starred is ever touched.
 */
export function enforceStorage(lib: Library, rules: StorageRules, now = Date.now()): JanitorResult {
  const res: JanitorResult = { removed: 0, freedBytes: 0, reason: null }
  const drop = (c: Clip, reason: 'age' | 'size') => {
    res.removed++
    res.freedBytes += c.sizeBytes || 0
    res.reason = res.reason ?? reason
    lib.remove(c.id)
  }

  if (rules.deleteAfterDays > 0) {
    const cutoff = now - rules.deleteAfterDays * 86400_000
    for (const c of lib.everything().filter((x) => !x.favorite && Date.parse(x.createdAt) < cutoff)) drop(c, 'age')
  }

  if (rules.maxGB > 0) {
    const limit = rules.maxGB * GB
    let used = lib.everything().reduce((n, c) => n + (c.sizeBytes || 0), 0)
    if (used > limit) {
      // Trash first (oldest deletion first), then the oldest clips that aren't favorites.
      const trash = lib.everything().filter((c) => c.trashedAt).sort((a, b) => Date.parse(a.trashedAt!) - Date.parse(b.trashedAt!))
      const live = lib.everything().filter((c) => !c.trashedAt && !c.favorite).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      for (const c of [...trash, ...live]) {
        if (used <= limit) break
        used -= c.sizeBytes || 0
        drop(c, 'size')
      }
    }
  }
  return res
}
