import { EventEmitter } from 'node:events'
import { screen } from 'electron'
import path from 'node:path'
import type { ActivityEvent, BufferStatus, Settings, TriggerSource } from '../shared/types'
import { ReplayBuffer } from './capture/replayBuffer'
import { gameNameFrom, getForegroundApp } from './capture/foreground'
import { Library } from './library'
import type { SettingsStore } from './settings'
import { VisionJudge } from './triggers/vision'
import { VoiceDetector } from './triggers/voice'

const VISION_COOLDOWN_MS = 20_000

/**
 * Coordinates the replay buffer, the triggers (hotkey / voice / vision) and the library.
 * Every trigger ends up in `clipRange`, which cuts the clip and registers it.
 */
export class Recorder extends EventEmitter<{ status: [BufferStatus]; activity: [ActivityEvent] }> {
  readonly buffer: ReplayBuffer
  readonly library: Library
  readonly voice: VoiceDetector
  private vision: VisionJudge
  status: BufferStatus = { running: false }
  activity: ActivityEvent[] = []
  private game = 'Desktop'
  private fgProcess = ''
  private gameTimer: NodeJS.Timeout | null = null
  private lastVisionClipAt = 0
  private pendingRanges: { startMs: number; endMs: number }[] = []

  constructor(private settings: SettingsStore, dataDir: string) {
    super()
    this.buffer = new ReplayBuffer(dataDir)
    this.library = new Library(dataDir)
    this.voice = new VoiceDetector(settings.get().voice)
    this.vision = new VisionJudge(settings.get().ai.anthropicApiKey, settings.get().ai.model)

    this.buffer.on('status', (st) => {
      this.status = { ...this.status, running: st.running, encoder: st.encoder ?? this.status.encoder, resolution: st.resolution ?? this.status.resolution, fps: st.fps ?? this.status.fps, lastError: st.error, since: st.running ? new Date().toISOString() : undefined }
      if (st.error) this.log('error', st.error)
      if (!st.running) this.voice.stop()
      this.pushStatus()
    })
    this.buffer.on('levels', ({ micDb, sysDb }) => {
      this.status.micLevelDb = micDb
      this.status.systemLevelDb = sysDb
      this.voice.onLevels(micDb, sysDb, 'mic')
    })
    this.buffer.on('log', (line) => this.log('info', line))
    this.buffer.on('snapshot', (jpeg) => void this.onSnapshot(jpeg))
    this.voice.on('state', (st) => {
      if (st.talking && this.settings.get().voice.enabled) this.log('voice', 'Voice detected, clip will be saved when it goes quiet')
    })
    this.voice.on('talk', (seg) => {
      if (!this.settings.get().voice.enabled) return
      void this.clipRange(seg.startMs - 2000, seg.endMs + 1000, 'voice', { event: seg.source === 'mic' ? 'You talking' : 'Voice chat' })
    })

    settings.onChange((s) => {
      this.voice.setRules(s.voice)
      this.vision = new VisionJudge(s.ai.anthropicApiKey, s.ai.model)
      this.buffer.snapshotIntervalSec = s.vision.intervalSeconds
    })
    this.buffer.snapshotIntervalSec = settings.get().vision.intervalSeconds
  }

  private pushStatus() {
    this.status.game = this.game
    this.emit('status', { ...this.status })
  }

  log(kind: ActivityEvent['kind'], message: string) {
    const ev: ActivityEvent = { at: new Date().toISOString(), kind, message }
    this.activity.unshift(ev)
    this.activity = this.activity.slice(0, 300)
    this.emit('activity', ev)
  }

  async start() {
    const s = this.settings.get()
    try {
      const displays = screen.getAllDisplays()
      const d = displays[Math.min(s.capture.monitorIndex, displays.length - 1)] ?? screen.getPrimaryDisplay()
      await this.buffer.start(s.capture, { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) })
      this.voice.start()
      this.vision.reset()
      this.log('info', `Replay buffer started (${this.buffer.encoder}, ${this.buffer.resolution} @ ${s.capture.fps} fps, keeps ${s.capture.bufferSeconds}s)`)
      if (!this.gameTimer) {
        this.gameTimer = setInterval(() => void this.pollGame(), 3000)
        void this.pollGame()
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.status = { running: false, lastError: msg }
      this.log('error', msg)
      this.pushStatus()
    }
  }

  async stop() {
    await this.buffer.stop()
    this.voice.stop()
    if (this.gameTimer) clearInterval(this.gameTimer)
    this.gameTimer = null
    this.log('info', 'Replay buffer stopped')
  }

  pushSystemAudio(pcm: Buffer, levelDb: number) {
    this.buffer.pushSystemAudio(pcm, levelDb)
    this.status.systemLevelDb = levelDb
    this.voice.onLevels(this.status.micLevelDb ?? -100, levelDb, 'sys')
  }

  private async pollGame() {
    const fg = await getForegroundApp()
    const name = gameNameFrom(fg)
    this.fgProcess = fg.process.toLowerCase()
    if (name !== this.game) {
      this.game = name
      this.vision.reset()
    }
    const s = this.settings.get()
    const blocked = this.recordingBlockedReason(s)
    const changed = blocked !== this.status.recordingBlocked
    this.status.recordingBlocked = blocked
    if (changed || name !== this.status.game) this.pushStatus()
  }

  /** Allow/block lists: "tell it what to record / not record" at the game level. */
  private recordingBlockedReason(s: Settings): string | undefined {
    const proc = this.fgProcess
    const norm = (x: string) => x.toLowerCase().replace(/\.exe$/, '').trim()
    if (s.blocklist.some((b) => norm(b) && (norm(b) === proc || this.game.toLowerCase().includes(norm(b))))) return `${this.game} is on your "never record" list`
    if (s.allowlist.length && !s.allowlist.some((a) => norm(a) && (norm(a) === proc || this.game.toLowerCase().includes(norm(a))))) return `${this.game} is not on your "only record" list`
    return undefined
  }

  /** Hotkey / manual: clip the last `preSeconds` plus the next `postSeconds`. */
  async clipNow(trigger: TriggerSource = 'hotkey') {
    const c = this.settings.get().capture
    const now = Date.now()
    return this.clipRange(now - c.preSeconds * 1000, now + c.postSeconds * 1000, trigger)
  }

  async clipRange(startMs: number, endMs: number, trigger: TriggerSource, meta: { event?: string; title?: string } = {}) {
    if (!this.buffer.running) {
      this.log('error', 'Cannot clip: replay buffer is not running')
      return
    }
    const blocked = this.status.recordingBlocked
    if (blocked && trigger !== 'hotkey' && trigger !== 'manual') {
      this.log('info', `Skipped ${trigger} clip: ${blocked}`)
      return
    }
    const oldest = this.buffer.oldestAvailableMs()
    if (oldest) startMs = Math.max(startMs, oldest)
    if (this.pendingRanges.some((r) => startMs < r.endMs && endMs > r.startMs && trigger !== 'hotkey')) return
    const range = { startMs, endMs }
    this.pendingRanges.push(range)
    const game = this.game
    const c = this.settings.get().capture
    const stamp = new Date(startMs).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const safeGame = game.replace(/[^\w\- ]+/g, '').trim() || 'Clip'
    const outFile = path.join(c.outputDir, safeGame, `${safeGame} ${stamp}.mp4`)
    this.log('info', `Saving ${trigger} clip (${Math.round((endMs - startMs) / 1000)}s)…`)
    try {
      const { file } = await this.buffer.saveRange({ startMs, endMs, outFile })
      const clip = await this.library.add(file, { game, trigger, event: meta.event, title: meta.title })
      this.log('clip', `Saved "${clip.title}" (${Math.round(clip.durationSec)}s)`)
      return clip
    } catch (e) {
      this.log('error', e instanceof Error ? e.message : String(e))
    } finally {
      this.pendingRanges = this.pendingRanges.filter((r) => r !== range)
    }
  }

  private async onSnapshot(jpeg: Buffer) {
    const s = this.settings.get()
    if (!s.vision.enabled || !this.vision.ready || this.status.recordingBlocked) return
    if (Date.now() - this.lastVisionClipAt < VISION_COOLDOWN_MS) return
    try {
      const verdict = await this.vision.judge(jpeg, s.vision, this.game)
      if (!verdict) return
      this.status.visionLastCheck = new Date().toISOString()
      this.status.visionLastVerdict = verdict.clip ? `${verdict.event} (${Math.round(verdict.confidence * 100)}%)` : `nothing (${verdict.why})`
      this.pushStatus()
      if (verdict.clip && verdict.confidence >= s.vision.minConfidence) {
        this.lastVisionClipAt = Date.now()
        this.log('vision', `Detected: ${verdict.event} - ${verdict.why}`)
        const now = Date.now()
        const start = now - (verdict.secondsAgo + s.capture.preSeconds) * 1000
        await this.clipRange(start, now + s.capture.postSeconds * 1000, 'vision', { event: verdict.event })
      }
    } catch (e) {
      this.log('error', `Vision check failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
