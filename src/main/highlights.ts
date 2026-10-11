import { EventEmitter } from 'node:events'
import type { Clip, TriggerSource } from '../shared/types'
import type { Library } from './library'

const TRIGGER_WEIGHT: Record<TriggerSource, number> = { vision: 25, hype: 22, hotkey: 15, voice: 10, manual: 8 }

/**
 * "How good is this clip?" without any AI: what you did with it (favorite, tags, views),
 * how it was made (an AI-detected moment or a shout beats a timed voice clip), how loud the
 * moment got, and whether the length is watchable.
 */
export function scoreClip(c: Clip): number {
  let s = TRIGGER_WEIGHT[c.trigger] ?? 0
  if (c.favorite) s += 50
  s += Math.min(3, c.tags.length) * 4
  s += Math.min(5, c.views ?? 0) * 3
  if (c.hypeDb !== undefined) s += Math.max(0, Math.min(20, c.hypeDb + 30))
  if (c.event) s += 6
  if (c.durationSec >= 8 && c.durationSec <= 45) s += 10
  else if (c.durationSec < 4) s -= 15
  if (c.title.endsWith('(trimmed)')) s += 5
  return s
}

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Best clip recorded on the given day (default: today), or undefined. */
export function clipOfTheDay(library: Library, day = new Date()): { clip: Clip; score: number } | undefined {
  const key = dayKey(day)
  const ranked = library
    .all()
    .filter((c) => dayKey(new Date(c.createdAt)) === key && c.game !== 'Desktop')
    .map((clip) => ({ clip, score: scoreClip(clip) }))
    .sort((a, b) => b.score - a.score)
  // Fall back to desktop clips only if nothing else exists that day.
  if (ranked.length) return ranked[0]
  const any = library.all().filter((c) => dayKey(new Date(c.createdAt)) === key).map((clip) => ({ clip, score: scoreClip(clip) })).sort((a, b) => b.score - a.score)
  return any[0]
}

/** Fires once a day at HH:MM with that day's best clip. */
export class DailyDigest extends EventEmitter<{ digest: [{ clip: Clip; score: number }]; empty: [] }> {
  private timer: NodeJS.Timeout | null = null
  private firedFor = ''

  constructor(private library: Library, private getTime: () => { enabled: boolean; time: string }) {
    super()
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), 30_000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick() {
    const { time } = this.getTime()
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const key = dayKey(now)
    if (hhmm !== time || this.firedFor === key) return
    this.firedFor = key
    const best = clipOfTheDay(this.library, now)
    if (best) this.emit('digest', best)
    else this.emit('empty')
  }
}
