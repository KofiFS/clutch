import { EventEmitter } from 'node:events'
import { screen } from 'electron'
import path from 'node:path'
import type { ActivityEvent, BufferStatus, CaptureSettings, Clip, GameInfo, Settings, TriggerSource } from '../shared/types'
import { ReplayBuffer } from './capture/replayBuffer'
import { getForegroundApp, toGameInfo } from './capture/foreground'
import { Library } from './library'
import type { SettingsStore } from './settings'
import { VisionJudge } from './triggers/vision'
import { VoiceDetector } from './triggers/voice'
import { HypeDetector } from './triggers/hype'
import { suggestTitle } from './triggers/titler'

const VISION_COOLDOWN_MS = 20_000
const GAME_POLL_MS = 3000

export interface RecorderEvents {
  status: [BufferStatus]
  activity: [ActivityEvent]
  clip: [Clip]
  game: [GameInfo]
}

/**
 * Coordinates the replay buffer, the triggers (hotkey / voice / vision), game detection and the library.
 * Every trigger ends up in `clipRange`, which cuts the clip and registers it.
 */
export class Recorder extends EventEmitter<RecorderEvents> {
  readonly buffer: ReplayBuffer
  readonly library: Library
  readonly voice: VoiceDetector
  readonly hype: HypeDetector
  private vision: VisionJudge
  status: BufferStatus = { running: false }
  activity: ActivityEvent[] = []
  game: GameInfo = { name: 'Desktop', process: '' }
  private gameTimer: NodeJS.Timeout | null = null
  private statusTimer: NodeJS.Timeout | null = null
  private lastVisionClipAt = 0
  private lastSysAudioAt = 0
  private lastGameSeenAt = 0
  private autoStarted = false
  private starting = false
  private activeCapture: CaptureSettings | null = null
  private pendingRanges: { startMs: number; endMs: number }[] = []

  constructor(private settings: SettingsStore, dataDir: string) {
    super()
    this.buffer = new ReplayBuffer(dataDir)
    this.library = new Library(dataDir)
    this.voice = new VoiceDetector(settings.get().voice)
    this.hype = new HypeDetector(settings.get().hype)
    this.vision = new VisionJudge(settings.get().ai.anthropicApiKey, settings.get().ai.model)

    this.buffer.on('status', (st) => {
      this.status = {
        ...this.status,
        running: st.running,
        starting: false,
        encoder: st.encoder ?? this.status.encoder,
        resolution: st.resolution ?? this.status.resolution,
        fps: st.fps ?? this.status.fps,
        lastError: st.error,
        since: st.running ? this.status.since ?? new Date().toISOString() : undefined
      }
      if (st.error) this.log('error', st.error)
      if (!st.running) { this.voice.stop(); this.status.talking = false; this.activeCapture = null }
      this.pushStatus()
    })
    this.buffer.on('levels', ({ micDb }) => {
      this.status.micLevelDb = micDb
      this.voice.onLevels(micDb, this.status.systemLevelDb ?? -100, 'mic')
      this.hype.feed('mic', micDb)
    })
    this.hype.on('hype', ({ at, peakDb, source }) => {
      if (!this.status.running) return
      this.log('hype', `Hype spike on ${source === 'mic' ? 'your mic' : 'voice chat'} (${Math.round(peakDb)} dB)`)
      const c = this.effectiveCapture()
      void this.clipRange(at - c.preSeconds * 1000, at + Math.max(4, c.postSeconds) * 1000, 'hype', { event: source === 'mic' ? 'Hype moment' : 'Voice chat went off', hypeDb: peakDb })
    })
    this.buffer.on('log', (line) => this.log('info', line))
    this.buffer.on('snapshot', (jpeg) => void this.onSnapshot(jpeg))
    this.voice.on('state', (st) => {
      this.status.talking = st.talking
      if (st.talking && this.settings.get().voice.enabled) this.log('voice', 'Voice detected - clip will be saved when it goes quiet')
      this.pushStatus()
    })
    this.voice.on('talk', (seg) => {
      if (!this.settings.get().voice.enabled) return
      void this.clipRange(seg.startMs - 2000, seg.endMs + 1000, 'voice', { event: seg.source === 'mic' ? 'You talking' : 'Voice chat' })
    })

    let lastVision = { enabled: settings.get().vision.enabled, interval: settings.get().vision.intervalSeconds }
    settings.onChange((s) => {
      this.voice.setRules(s.voice)
      this.hype.setRules(s.hype)
      this.vision = new VisionJudge(s.ai.anthropicApiKey, s.ai.model)
      this.buffer.snapshotIntervalSec = s.vision.intervalSeconds
      this.buffer.snapshotsEnabled = s.vision.enabled
      // The screenshot branch is part of the FFmpeg graph, so toggling AI watching needs a quick restart.
      const changed = lastVision.enabled !== s.vision.enabled || (s.vision.enabled && lastVision.interval !== s.vision.intervalSeconds)
      lastVision = { enabled: s.vision.enabled, interval: s.vision.intervalSeconds }
      if (changed && this.status.running && !this.starting) {
        this.log('info', s.vision.enabled ? 'Turning on screen watching…' : 'Screen watching off - recording with no extra overhead')
        const auto = this.autoStarted
        void this.buffer.stop().then(() => this.start(auto ? 'auto' : 'manual'))
      }
    })
    this.buffer.snapshotIntervalSec = settings.get().vision.intervalSeconds
    this.buffer.snapshotsEnabled = settings.get().vision.enabled

    this.gameTimer = setInterval(() => void this.pollGame(), GAME_POLL_MS)
    void this.pollGame()
    // Light status heartbeat: buffered seconds + system-audio liveness.
    this.statusTimer = setInterval(() => {
      if (!this.status.running) return
      const oldest = this.buffer.oldestAvailableMs()
      this.status.bufferedSeconds = oldest ? Math.round((Date.now() - oldest) / 1000) : 0
      // Hidden windows deliver audio in bursts, so allow a few seconds between chunks.
      this.status.systemAudioActive = Date.now() - this.lastSysAudioAt < 5000
      this.pushStatus()
    }, 2000)
  }

  private pushStatus() {
    this.status.game = this.game.name
    this.status.gameInfo = this.game
    this.emit('status', { ...this.status })
  }

  setHotkeyRegistered(ok: boolean) {
    this.status.hotkeyRegistered = ok
    this.pushStatus()
  }

  log(kind: ActivityEvent['kind'], message: string, clipId?: string) {
    const ev: ActivityEvent = { at: new Date().toISOString(), kind, message, clipId }
    this.activity.unshift(ev)
    this.activity = this.activity.slice(0, 300)
    this.emit('activity', ev)
  }

  /** Capture settings with the current game's profile applied. */
  effectiveCapture(): CaptureSettings {
    const s = this.settings.get()
    const profile = s.profiles[this.game.process]
    if (!profile) return s.capture
    const { name: _name, ...overrides } = profile
    return { ...s.capture, ...overrides }
  }

  async start(reason: 'manual' | 'auto' = 'manual') {
    if (this.starting || this.status.running) return
    this.starting = true
    this.status.starting = true
    this.status.lastError = undefined
    this.pushStatus()
    const s = this.settings.get()
    const capture = this.effectiveCapture()
    try {
      const displays = screen.getAllDisplays()
      const d = displays[Math.min(capture.monitorIndex, displays.length - 1)] ?? screen.getPrimaryDisplay()
      this.status.since = new Date().toISOString()
      await this.buffer.start(capture, { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) })
      this.activeCapture = capture
      this.autoStarted = reason === 'auto'
      this.voice.start()
      this.hype.reset()
      this.vision.reset()
      const profileNote = s.profiles[this.game.process] ? ` using the ${s.profiles[this.game.process].name} profile` : ''
      this.log('info', `Recording started${reason === 'auto' ? ` for ${this.game.name}` : ''} (${this.buffer.encoder}, ${this.buffer.resolution} @ ${capture.fps} fps, keeps ${capture.bufferSeconds}s)${profileNote}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.status = { ...this.status, running: false, starting: false, lastError: msg }
      this.log('error', msg)
      this.pushStatus()
    } finally {
      this.starting = false
      this.status.starting = false
      this.pushStatus()
    }
  }

  async stop(reason: 'manual' | 'auto' = 'manual') {
    if (!this.status.running && !this.buffer.running) return
    await this.buffer.stop()
    this.voice.stop()
    this.autoStarted = false
    this.log('info', reason === 'auto' ? 'Recording stopped - no game open' : 'Recording stopped')
  }

  pushSystemAudio(pcm: Buffer, levelDb: number) {
    this.buffer.pushSystemAudio(pcm, levelDb)
    this.lastSysAudioAt = Date.now()
    this.status.systemLevelDb = levelDb
    this.voice.onLevels(this.status.micLevelDb ?? -100, levelDb, 'sys')
    this.hype.feed('system', levelDb)
  }

  private async pollGame() {
    const s = this.settings.get()
    const fg = await getForegroundApp()
    const info = await toGameInfo(fg, s.allowlist)
    const changed = info.process !== this.game.process
    if (changed) {
      this.game = info
      this.vision.reset()
      this.emit('game', info)
      if (info.isGame) this.log('game', `${info.name} is in front`)
    }
    if (info.isGame) this.lastGameSeenAt = Date.now()

    const blocked = this.recordingBlockedReason(s)
    const blockedChanged = blocked !== this.status.recordingBlocked
    this.status.recordingBlocked = blocked

    // Auto start / stop
    if (s.app.autoStart === 'games' && info.isGame && !blocked && !this.status.running && !this.starting) {
      this.log('game', `Starting recording for ${info.name}`)
      await this.start('auto')
    } else if (this.autoStarted && this.status.running && s.app.autoStopMinutes > 0 && Date.now() - this.lastGameSeenAt > s.app.autoStopMinutes * 60_000) {
      await this.stop('auto')
    }

    // Per-game profile switch while running
    if (changed && this.status.running && this.activeCapture && info.isGame) {
      const next = this.effectiveCapture()
      const differs = (['fps', 'quality', 'resolutionScale'] as const).some((k) => next[k] !== this.activeCapture![k])
      if (differs) {
        this.log('game', `Switching to the ${s.profiles[info.process]?.name ?? 'default'} capture profile for ${info.name}`)
        await this.buffer.stop()
        await this.start(this.autoStarted ? 'auto' : 'manual')
      }
    }
    if (changed || blockedChanged) this.pushStatus()
  }

  /** Allow/block lists: "tell it what to record / not record" at the game level. */
  private recordingBlockedReason(s: Settings): string | undefined {
    const proc = this.game.process
    const norm = (x: string) => x.toLowerCase().replace(/\.exe$/, '').trim()
    const matches = (x: string) => norm(x) && (norm(x) === proc || this.game.name.toLowerCase().includes(norm(x)))
    if (s.blocklist.some(matches)) return `${this.game.name} is on your "never clip" list`
    if (s.allowlist.length && !s.allowlist.some(matches)) return `${this.game.name} is not on your "only clip in" list`
    return undefined
  }

  /** Hotkey / manual: clip the last `preSeconds` plus the next `postSeconds`. */
  async clipNow(trigger: TriggerSource = 'hotkey', seconds?: number) {
    const c = this.effectiveCapture()
    const now = Date.now()
    const back = Math.min(seconds ?? c.preSeconds, c.bufferSeconds)
    return this.clipRange(now - back * 1000, now + c.postSeconds * 1000, trigger)
  }

  /** Length presets that fit in the current buffer, ascending. */
  lengthOptions(): number[] {
    const s = this.settings.get()
    const max = this.effectiveCapture().bufferSeconds
    const list = [...new Set(s.capture.lengthPresets)].filter((n) => n > 0 && n <= max).sort((a, b) => a - b)
    return list.length ? list : [Math.min(max, this.effectiveCapture().preSeconds)]
  }

  /** Set how far back the main clip hotkey reaches. Writes to the game's profile if it overrides it. */
  setClipLength(seconds: number) {
    const s = this.settings.get()
    const profile = s.profiles[this.game.process]
    if (profile && profile.preSeconds !== undefined) {
      this.settings.set({ profiles: { ...s.profiles, [this.game.process]: { ...profile, preSeconds: seconds } } })
    } else {
      this.settings.set({ capture: { ...s.capture, preSeconds: seconds } })
    }
    this.log('info', `Clip length set to ${seconds}s`)
  }

  /** In-game length hotkeys: step through the presets. */
  stepClipLength(dir: 1 | -1): { seconds: number; edge: 'min' | 'max' | null } {
    const opts = this.lengthOptions()
    const cur = this.effectiveCapture().preSeconds
    let next: number
    if (dir > 0) next = opts.find((n) => n > cur) ?? opts[opts.length - 1]
    else next = [...opts].reverse().find((n) => n < cur) ?? opts[0]
    if (next !== cur) this.setClipLength(next)
    return { seconds: next, edge: next === opts[opts.length - 1] && dir > 0 ? 'max' : next === opts[0] && dir < 0 ? 'min' : null }
  }

  async clipRange(startMs: number, endMs: number, trigger: TriggerSource, meta: { event?: string; title?: string; hypeDb?: number } = {}) {
    if (!this.buffer.running) {
      this.log('error', 'Cannot clip: recording is not running')
      return
    }
    const blocked = this.status.recordingBlocked
    if (blocked && trigger !== 'hotkey' && trigger !== 'manual') {
      this.log('info', `Skipped ${trigger} clip: ${blocked}`)
      return
    }
    const oldest = this.buffer.oldestAvailableMs()
    if (oldest) startMs = Math.max(startMs, oldest)
    if (this.pendingRanges.some((r) => startMs < r.endMs && endMs > r.startMs && trigger !== 'hotkey' && trigger !== 'manual')) return
    const range = { startMs, endMs }
    this.pendingRanges.push(range)
    const game = this.game
    const c = this.settings.get().capture
    const stamp = new Date(startMs).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const safeGame = game.name.replace(/[^\w\- ]+/g, '').trim() || 'Clip'
    const outFile = path.join(c.outputDir, safeGame, `${safeGame} ${stamp}.mp4`)
    this.log('info', `Saving ${trigger === 'manual' ? '' : trigger + ' '}clip (${Math.round((endMs - startMs) / 1000)}s)…`)
    try {
      const { file } = await this.buffer.saveRange({ startMs, endMs, outFile })
      const clip = await this.library.add(file, { game: game.name, gameProcess: game.process || undefined, gameIcon: game.icon, trigger, event: meta.event, title: meta.title, hypeDb: meta.hypeDb })
      this.log('clip', `Saved "${clip.title}" (${Math.round(clip.durationSec)}s)`, clip.id)
      this.emit('clip', clip)
      void this.autoTitle(clip)
      return clip
    } catch (e) {
      this.log('error', e instanceof Error ? e.message : String(e))
    } finally {
      this.pendingRanges = this.pendingRanges.filter((r) => r !== range)
    }
  }

  /** Optional AI layer: rename the clip from its thumbnail. Silent no-op when off or without a key. */
  private async autoTitle(clip: Clip) {
    const s = this.settings.get()
    if (!s.ai.autoTitle || !(s.ai.anthropicApiKey || process.env.ANTHROPIC_API_KEY)) return
    try {
      const title = await suggestTitle({ apiKey: s.ai.anthropicApiKey, model: s.ai.model, thumbnail: clip.thumbnail, game: clip.game, event: clip.event, trigger: clip.trigger })
      const fresh = this.library.get(clip.id)
      // Don't overwrite a name the user typed in the meantime.
      if (title && fresh && fresh.title === clip.title) {
        this.library.update(clip.id, { title })
        this.log('info', `Named "${title}"`, clip.id)
      }
    } catch (e) {
      this.log('info', `Auto-title skipped: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private async onSnapshot(jpeg: Buffer) {
    const s = this.settings.get()
    if (!s.vision.enabled || !this.vision.ready || this.status.recordingBlocked) return
    if (Date.now() - this.lastVisionClipAt < VISION_COOLDOWN_MS) return
    try {
      const verdict = await this.vision.judge(jpeg, s.vision, this.game.name)
      if (!verdict) return
      this.status.visionLastCheck = new Date().toISOString()
      this.status.visionLastVerdict = verdict.clip ? `${verdict.event} (${Math.round(verdict.confidence * 100)}%)` : `nothing (${verdict.why})`
      this.pushStatus()
      if (verdict.clip && verdict.confidence >= s.vision.minConfidence) {
        this.lastVisionClipAt = Date.now()
        this.log('vision', `Detected: ${verdict.event} - ${verdict.why}`)
        const now = Date.now()
        const c = this.effectiveCapture()
        const start = now - (verdict.secondsAgo + c.preSeconds) * 1000
        await this.clipRange(start, now + c.postSeconds * 1000, 'vision', { event: verdict.event })
      }
    } catch (e) {
      this.log('error', `Vision check failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  dispose() {
    if (this.gameTimer) clearInterval(this.gameTimer)
    if (this.statusTimer) clearInterval(this.statusTimer)
  }
}
