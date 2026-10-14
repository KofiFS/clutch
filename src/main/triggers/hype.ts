import { EventEmitter } from 'node:events'
import type { HypeRules } from '../../shared/types'

const COOLDOWN_MS = 15_000
/** Time constant of the rolling "normal loudness" average. */
const BASELINE_SECONDS = 12
/** How long after recording starts nothing fires while the baseline learns the room. */
const WARMUP_MS = 10_000

/**
 * No-AI highlight detector. Keeps a slow rolling average of how loud the mic / voice chat usually
 * is and fires when the level jumps well above it: yelling, laughing, "NO WAY". Costs a few
 * arithmetic ops per audio level update (~10 per second), nothing else.
 */
export class HypeDetector extends EventEmitter<{ hype: [{ at: number; peakDb: number; source: 'mic' | 'system' }] }> {
  private baseline: Record<'mic' | 'system', number> = { mic: -50, system: -50 }
  private lastAt: Record<'mic' | 'system', number> = { mic: 0, system: 0 }
  private lastFire = 0
  private warmupUntil = 0

  constructor(private rules: HypeRules) {
    super()
  }

  setRules(rules: HypeRules) {
    this.rules = rules
  }

  private seeded: Record<'mic' | 'system', boolean> = { mic: false, system: false }

  /** Call when recording starts so the baseline settles before anything fires. */
  reset() {
    this.seeded = { mic: false, system: false }
    this.warmupUntil = Date.now() + WARMUP_MS
  }

  feed(source: 'mic' | 'system', db: number) {
    const r = this.rules
    if (!r.enabled) return
    if (source === 'mic' && !r.onMic) return
    if (source === 'system' && !r.onSystemAudio) return
    const now = Date.now()
    const dt = Math.min(1, Math.max(0.01, (now - (this.lastAt[source] || now)) / 1000))
    this.lastAt[source] = now
    const level = Math.max(-90, db)
    // Start from what the mic actually hears, not an assumed silence: otherwise the first normal
    // sound after recording starts (typing, talking) looks like a huge spike.
    if (!this.seeded[source]) { this.seeded[source] = true; this.baseline[source] = level }
    const base = this.baseline[source]
    // During warm-up follow the room quickly; after that the baseline rises slowly so one shout
    // doesn't raise the bar.
    const warming = now < this.warmupUntil
    const alpha = dt / (warming ? 1.5 : level > base ? BASELINE_SECONDS * 2 : BASELINE_SECONDS)
    this.baseline[source] = base + (level - base) * Math.min(1, alpha)

    if (now < this.warmupUntil || now - this.lastFire < COOLDOWN_MS) return
    if (level >= r.minDb && level - base >= r.spikeDb) {
      this.lastFire = now
      this.emit('hype', { at: now, peakDb: level, source })
    }
  }
}
