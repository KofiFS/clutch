import { EventEmitter } from 'node:events'
import type { VoiceRules } from '../../shared/types'

export interface TalkSegment {
  startMs: number
  endMs: number
  source: 'mic' | 'system' | 'both'
}

/**
 * "Only record when people talk." Watches mic / system-audio loudness and emits one
 * `talk` event per burst of conversation: it starts after `minSpeechSeconds` of sound above the
 * threshold and ends after `silenceSeconds` of quiet (or at `maxClipSeconds`).
 */
export class VoiceDetector extends EventEmitter<{ talk: [TalkSegment]; state: [{ talking: boolean; since?: number }] }> {
  private rules: VoiceRules
  private loudSince = 0
  private quietSince = 0
  private talkingSince = 0
  private usedMic = false
  private usedSys = false
  private timer: NodeJS.Timeout | null = null
  private micDb = -100
  private sysDb = -100
  private micAt = 0
  private sysAt = 0

  constructor(rules: VoiceRules) {
    super()
    this.rules = rules
  }

  setRules(rules: VoiceRules) {
    this.rules = rules
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), 100)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.flush()
  }

  onLevels(micDb: number, sysDb: number, which: 'mic' | 'sys' | 'both') {
    const now = Date.now()
    if (which !== 'sys') { this.micDb = micDb; this.micAt = now }
    if (which !== 'mic') { this.sysDb = sysDb; this.sysAt = now }
  }

  private tick() {
    const r = this.rules
    const now = Date.now()
    // Levels older than a second mean that source went quiet / disconnected.
    const mic = r.onMic && now - this.micAt < 1000 && this.micDb > r.thresholdDb
    const sys = r.onSystemAudio && now - this.sysAt < 1000 && this.sysDb > r.thresholdDb
    const loud = mic || sys

    if (loud) {
      if (!this.loudSince) this.loudSince = now
      this.quietSince = 0
      if (mic) this.usedMic = true
      if (sys) this.usedSys = true
      if (!this.talkingSince && now - this.loudSince >= r.minSpeechSeconds * 1000) {
        this.talkingSince = this.loudSince
        this.emit('state', { talking: true, since: this.talkingSince })
      }
    } else {
      this.loudSince = 0
      if (this.talkingSince) {
        if (!this.quietSince) this.quietSince = now
        if (now - this.quietSince >= r.silenceSeconds * 1000) this.flush()
      }
    }
    if (this.talkingSince && now - this.talkingSince >= r.maxClipSeconds * 1000) this.flush()
  }

  private flush() {
    if (!this.talkingSince) return
    const seg: TalkSegment = {
      startMs: this.talkingSince,
      endMs: this.quietSince || Date.now(),
      source: this.usedMic && this.usedSys ? 'both' : this.usedMic ? 'mic' : 'system'
    }
    this.talkingSince = this.quietSince = this.loudSince = 0
    this.usedMic = this.usedSys = false
    this.emit('state', { talking: false })
    this.emit('talk', seg)
  }
}
