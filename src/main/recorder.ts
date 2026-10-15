import { EventEmitter } from 'node:events'
import { nativeImage, screen } from 'electron'
import path from 'node:path'
import type { ActivityEvent, BufferStatus, CaptureSettings, Clip, GameInfo, Settings, TriggerSource } from '../shared/types'
import { ReplayBuffer } from './capture/replayBuffer'
import { listAudioDevices } from './capture/ffmpeg'
import { cachedIcon, gameNameFrom, getForegroundApp, getWindowRect, listRunningApps, looksLikeGame, toGameInfo } from './capture/foreground'
import { outputIndexFor } from './capture/outputs'
import type { CaptureSource } from './capture/replayBuffer'
import { Library } from './library'
import type { SettingsStore } from './settings'
import { VisionJudge, type CloudJudge } from './triggers/vision'
import { VoiceDetector } from './triggers/voice'
import { VoiceCommands } from './capture/voiceCommands'
import { HypeDetector } from './triggers/hype'
import { suggestTitle } from './triggers/titler'
import { enforceStorage, freeBytes } from './library/janitor'

const VISION_COOLDOWN_MS = 20_000
const fmtDuration = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min ${s % 60}s` }
const GAME_POLL_MS = 3000

export interface RecorderEvents {
  status: [BufferStatus]
  /** Fast (~10 Hz) audio levels for meters; kept out of `status` so the whole UI doesn't re-render. */
  levels: [{ micDb: number; sysDb: number; sources: Record<string, number> }]
  activity: [ActivityEvent]
  clip: [Clip]
  game: [GameInfo]
  /** Short confirmation for hotkey actions, shown over the game. */
  notice: [{ title: string; sub: string; kind: 'clip' | 'info' | 'error' }]
  /** A new session was started because a game came to the front. */
  autoStarted: []
}

/**
 * Coordinates the replay buffer, the triggers (hotkey / voice / vision), game detection and the library.
 * Every trigger ends up in `clipRange`, which cuts the clip and registers it.
 */
export class Recorder extends EventEmitter<RecorderEvents> {
  readonly buffer: ReplayBuffer
  readonly library: Library
  readonly voice: VoiceDetector
  /** "Clip that": spoken commands, listening only while recording. */
  readonly voiceCommands = new VoiceCommands()
  private voiceTestUntil = 0
  readonly hype: HypeDetector
  private vision: VisionJudge
  status: BufferStatus = { running: false }
  activity: ActivityEvent[] = []
  game: GameInfo = { name: 'Desktop', process: '' }
  private gameTimer: NodeJS.Timeout | null = null
  private scanTimer: NodeJS.Timeout | null = null
  private storageTimer: NodeJS.Timeout | null = null
  private diskTimer: NodeJS.Timeout | null = null
  private lastLowDiskNotice = 0
  private scanning = false
  private statusTimer: NodeJS.Timeout | null = null
  private lastVisionClipAt = 0
  private lastSysAudioAt = 0
  private lastGameSeenAt = 0
  private autoStarted = false
  private starting = false
  private activeCapture: CaptureSettings | null = null
  private pendingRanges: { startMs: number; endMs: number }[] = []
  private long: { startMs: number; bookmarks: number[]; game: GameInfo; pauses: { from: number; to: number }[] } | null = null
  /** Set while the user has paused recording: FFmpeg is stopped but the buffer and long recording are kept. */
  private paused: { at: number; elapsedMs: number; auto: boolean } | null = null
  /**
   * The last game seen in front, kept while its process runs. With a game on one half of an
   * ultrawide and a browser or Discord on the other, focus moves away from the game all the time;
   * recording carries on and clips stay filed under the game, like Medal.
   */
  private stickyGame: { info: GameInfo; pid: number } | null = null
  private cloudJudge: CloudJudge | null = null
  private watching = false
  private lastLoudAt = 0
  private lastLum: Float32Array | null = null
  private visionCalls: number[] = []
  private visionStats = { checks: 0, skipped: 0 }
  /** Last app in front other than the desktop or Clutch. */
  lastApp: GameInfo | null = null

  constructor(private settings: SettingsStore, dataDir: string) {
    super()
    this.buffer = new ReplayBuffer(dataDir)
    this.library = new Library(dataDir)
    this.voice = new VoiceDetector(settings.get().voice)
    this.hype = new HypeDetector(settings.get().hype)
    this.vision = this.makeVision(settings.get())

    this.buffer.on('status', (st) => {
      this.status = {
        ...this.status,
        running: st.running,
        starting: false,
        encoder: st.encoder ?? this.status.encoder,
        resolution: st.resolution ?? this.status.resolution,
        fps: st.fps ?? this.status.fps,
        lastError: st.error,
        // A pause keeps the session clock (the widget shows time recorded, not time since start).
        since: st.running ? this.status.since ?? new Date().toISOString() : this.paused ? this.status.since : undefined
      }
      if (st.error) this.log('error', st.error)
      if (!st.running) { this.voice.stop(); this.status.talking = false; this.activeCapture = null; if (!this.paused) this.applyVoiceCommands() }
      this.pushStatus()
    })
    this.buffer.on('levels', ({ micDb, sources }) => {
      this.status.micLevelDb = micDb
      this.emit('levels', { micDb, sysDb: this.status.systemLevelDb ?? -100, sources })
      this.voice.onLevels(micDb, this.status.systemLevelDb ?? -100, 'mic')
      this.hype.feed('mic', micDb)
      if (micDb > -24) this.lastLoudAt = Date.now()
    })
    this.hype.on('hype', ({ at, peakDb, source }) => {
      this.lastLoudAt = Date.now()
      if (!this.status.running || !this.autoClipAllowed()) return
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
      if (!this.settings.get().voice.enabled || !this.autoClipAllowed()) return
      void this.clipRange(seg.startMs - 2000, seg.endMs + 1000, 'voice', { event: seg.source === 'mic' ? 'You talking' : 'Voice chat' })
    })

    let lastAudio = JSON.stringify(settings.get().capture.audioSources)
    let lastLists = JSON.stringify([settings.get().extraGames, settings.get().allowlist, settings.get().blocklist])
    // Spoken commands run the same actions as the hotkeys.
    this.voiceCommands.on('command', ({ action, phrase }) => {
      if (action === 'clip') {
        if (!this.status.running && !this.paused) return
        this.log('clip', `Heard "${phrase}"`)
        const c = this.effectiveCapture()
        const now = this.paused ? this.paused.at : Date.now()
        void this.clipRange(now - Math.min(c.preSeconds, c.bufferSeconds) * 1000, this.paused ? now : now + c.postSeconds * 1000, 'hotkey', { event: `Said "${phrase}"` })
      } else if (action === 'bookmark') this.bookmark()
      else void this.toggleLong()
    })
    this.voiceCommands.on('error', (m) => this.log('info', `Voice commands: ${m}`))
    let lastVoiceCmd = JSON.stringify([settings.get().voiceCommands, settings.get().capture.audioSources, settings.get().capture.micDevice])
    settings.onChange((s) => {
      const v = JSON.stringify([s.voiceCommands, s.capture.audioSources, s.capture.micDevice])
      if (v !== lastVoiceCmd) { lastVoiceCmd = v; this.applyVoiceCommands() }
    })
    settings.onChange((s) => {
      // The game lists changed: forget the remembered game only if it no longer counts as a game.
      const lists = JSON.stringify([s.extraGames, s.allowlist, s.blocklist])
      if (lists !== lastLists) {
        lastLists = lists
        const g = this.stickyGame?.info
        if (g && !looksLikeGame({ process: g.process, title: g.name, exePath: g.exePath ?? '', fullscreen: false }, s.allowlist, s.extraGames ?? [])) this.stickyGame = null
      }
      const audio = JSON.stringify(s.capture.audioSources)
      if (audio !== lastAudio) {
        lastAudio = audio
        if (this.status.running && !this.starting && !this.long) {
          this.log('info', 'Audio sources changed - restarting recording')
          const auto = this.autoStarted
          void this.buffer.stop().then(() => this.start(auto ? 'auto' : 'manual'))
        }
      }
      this.voice.setRules(s.voice)
      this.hype.setRules(s.hype)
      this.vision = this.makeVision(s)
      this.applyWatching()
    })
    this.buffer.snapshotIntervalSec = settings.get().vision.intervalSeconds
    this.buffer.snapshotsEnabled = settings.get().vision.enabled && this.vision.ready
    this.watching = this.buffer.snapshotsEnabled
    if (settings.get().vision.enabled && !this.vision.ready) this.log('info', 'Screen watching is on but needs an AI key or a Clutch account, so it is paused.')

    // Storage rules: on start, every 10 min, after each clip, and when the rules change.
    setTimeout(() => this.tidyStorage(), 5000)
    this.storageTimer = setInterval(() => this.tidyStorage(), 10 * 60_000)
    this.on('clip', () => this.tidyStorage())
    let lastRules = JSON.stringify(settings.get().storage)
    settings.onChange((s) => { const r = JSON.stringify(s.storage); if (r !== lastRules) { lastRules = r; this.tidyStorage() } })
    this.diskTimer = setInterval(() => void this.checkDisk(), 60_000)
    void this.checkDisk()

    this.gameTimer = setInterval(() => void this.pollGame(), GAME_POLL_MS)
    void this.pollGame().then(() => this.findAlreadyRunning())
    // A game started before Clutch (or left open behind another window) is picked up within ~15 s.
    this.scanTimer = setInterval(() => void this.findAlreadyRunning(), 15_000)
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

  async start(reason: 'manual' | 'auto' = 'manual', opts: { resume?: { sinceMs: number } } = {}): Promise<boolean> {
    if (this.starting || this.status.running) return this.status.running
    // Starting while paused is a resume.
    if (this.paused && !opts.resume) return this.resume()
    this.starting = true
    this.status.starting = true
    this.status.lastError = undefined
    this.pushStatus()
    const s = this.settings.get()
    const capture = this.effectiveCapture()
    try {
      const displays = screen.getAllDisplays()
      const d = displays[Math.min(capture.monitorIndex, displays.length - 1)] ?? screen.getPrimaryDisplay()
      this.status.since = new Date(opts.resume?.sinceMs ?? Date.now()).toISOString()
      const monW = Math.round(d.size.width * d.scaleFactor)
      const monH = Math.round(d.size.height * d.scaleFactor)
      const { source, label, fallback } = await this.resolveArea(capture, d, monW, monH)
      // A missing mic would make FFmpeg fail to start at all, so leave unplugged ones out.
      const wanted = (capture.audioSources ?? []).filter((x) => x.enabled && x.kind === 'mic' && x.device)
      if (wanted.length) {
        const present = await listAudioDevices()
        const missing = wanted.filter((x) => !present.includes(x.device!))
        this.buffer.missingSources = missing.map((x) => x.id)
        for (const m of missing) this.log('info', `${m.name} (${m.device}) is not plugged in - recording without it`)
      } else this.buffer.missingSources = []
      this.status.areaLabel = label
      await this.buffer.start(capture, source, { restart: !!opts.resume })
      if (source.window && fallback) {
        // Window capture can be refused (very old Windows, protected windows): fall back to
        // cropping the window's own monitor.
        await new Promise((r) => setTimeout(r, 2500))
        if (!this.buffer.running) {
          this.log('info', `Window capture was not available for this window, recording its area of the screen instead`)
          this.status.areaLabel = fallback.label
          await this.buffer.start(capture, fallback.source, { restart: true })
        }
      }
      this.activeCapture = capture
      this.autoStarted = reason === 'auto'
      this.voice.start()
      this.applyVoiceCommands()
      this.hype.reset()
      this.vision.reset()
      const profileNote = s.profiles[this.game.process] ? ` using the ${s.profiles[this.game.process].name} profile` : ''
      if (!opts.resume) this.log('info', `Recording started${reason === 'auto' ? ` for ${this.game.name}` : ''} (${this.buffer.encoder}, ${this.buffer.resolution} @ ${capture.fps} fps, keeps ${capture.bufferSeconds}s)${profileNote}`)
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.status = { ...this.status, running: false, starting: false, lastError: msg }
      this.log('error', msg)
      this.pushStatus()
      return false
    } finally {
      this.starting = false
      this.status.starting = false
      this.pushStatus()
    }
  }

  get isPaused() {
    return !!this.paused
  }

  /**
   * Pause: stop capturing (nothing new is recorded) but keep what is already in the buffer and any
   * long recording, so clips and the session carry on after `resume`.
   */
  async pause() {
    if (this.paused || this.starting || !this.buffer.running) return
    const at = Date.now()
    const since = this.status.since ? Date.parse(this.status.since) : at
    this.paused = { at, elapsedMs: Math.max(0, at - since), auto: this.autoStarted }
    this.status.paused = { since: new Date(at).toISOString() }
    await this.buffer.stop()
    this.log('info', 'Recording paused - nothing is captured until you resume')
    this.emit('notice', { title: 'Recording paused', sub: 'Nothing is recorded until you resume', kind: 'info' })
    this.pushStatus()
  }

  async resume(): Promise<boolean> {
    const p = this.paused
    if (!p) return this.status.running
    const ok = await this.start(p.auto ? 'auto' : 'manual', { resume: { sinceMs: Date.now() - p.elapsedMs } })
    if (!ok) return false
    this.paused = null
    this.status.paused = undefined
    this.long?.pauses.push({ from: p.at, to: Date.now() })
    this.log('info', `Recording resumed after ${fmtDuration(Date.now() - p.at)}`)
    this.emit('notice', { title: 'Recording resumed', sub: this.long ? 'Long recording continues' : 'Replay buffer is running again', kind: 'info' })
    this.pushStatus()
    return true
  }

  async togglePause() {
    return this.paused ? this.resume() : this.pause()
  }

  /** Turn the configured capture area into a crop rectangle on the monitor (undefined = whole monitor). */
  /**
   * What to record. Window modes capture the window itself (any monitor, nothing on top of it gets
   * in); `fallback` crops that window's area out of the monitor it is actually on.
   */
  private async resolveArea(capture: CaptureSettings, d: Electron.Display, monW: number, monH: number): Promise<{ source: CaptureSource; label: string; fallback?: { source: CaptureSource; label: string } }> {
    const area = capture.area ?? { kind: 'monitor' }
    const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)
    const evenOff = (n: number) => Math.floor(n / 2) * 2
    const clampTo = (W: number, H: number, r: { x: number; y: number; w: number; h: number }) => {
      const x = Math.max(0, Math.min(W - 64, Math.round(r.x)))
      const y = Math.max(0, Math.min(H - 64, Math.round(r.y)))
      const w = even(Math.min(W - x, r.w))
      const h = even(Math.min(H - y, r.h))
      // Covering (nearly) the whole monitor is the same as no crop.
      if (w >= W - 2 && h >= H - 2) return undefined
      return { x: evenOff(x), y: evenOff(y), w, h }
    }
    const whole: CaptureSource = { width: monW, height: monH }
    if (area.kind === 'region') {
      const crop = clampTo(monW, monH, area)
      return { source: { ...whole, crop }, label: crop ? `${area.label ?? 'Custom area'} ${crop.w}x${crop.h}` : 'Full screen' }
    }
    if (area.kind === 'window' || area.kind === 'game') {
      const proc = area.kind === 'window' ? area.process : this.game.isGame ? this.game.process : ''
      const name = area.kind === 'window' ? area.title || area.process : this.game.name
      if (!proc) return { source: whole, label: 'Full screen (no game in front yet)' }
      const r = await getWindowRect(proc)
      if (!r || r.minimized) {
        this.log('info', `${name} window not found, recording the whole screen`)
        return { source: whole, label: `Full screen (${name} not open)` }
      }
      // The monitor the window is on (by its center), for the fallback crop.
      const centerDip = screen.screenToDipPoint({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
      const md = screen.getDisplayNearestPoint(centerDip)
      const sf = md.scaleFactor
      const mW = Math.round(md.size.width * sf)
      const mH = Math.round(md.size.height * sf)
      const crop = clampTo(mW, mH, { x: r.x - Math.round(md.bounds.x * sf), y: r.y - Math.round(md.bounds.y * sf), w: r.w, h: r.h })
      const outputIdx = await outputIndexFor(md)
      const fallback = { source: { width: mW, height: mH, crop, outputIdx } as CaptureSource, label: crop ? `${name} area ${crop.w}x${crop.h}` : `${name} (fullscreen)` }
      // CLUTCH_NO_WGC=1 forces the screen-crop path (troubleshooting).
      if (!r.hwnd || process.env.CLUTCH_NO_WGC) return fallback
      return { source: { width: even(r.w), height: even(r.h), window: { hwnd: r.hwnd } }, label: `${name} window`, fallback }
    }
    return { source: whole, label: 'Full screen' }
  }

  async stop(reason: 'manual' | 'auto' = 'manual') {
    if (!this.status.running && !this.buffer.running && !this.paused) return
    if (this.long) await this.stopLong()
    const wasPaused = !!this.paused
    this.paused = null
    this.status.paused = undefined
    await this.buffer.stop()
    if (wasPaused) { this.status.since = undefined; this.pushStatus() }
    this.voice.stop()
    this.applyVoiceCommands()
    this.autoStarted = false
    this.log('info', reason === 'auto' ? 'Recording stopped - no game open' : 'Recording stopped')
  }

  pushSystemAudio(pcm: Buffer, levelDb: number) {
    this.buffer.pushSystemAudio(pcm, levelDb)
    this.lastSysAudioAt = Date.now()
    this.status.systemLevelDb = levelDb
    if (levelDb > -14) this.lastLoudAt = Date.now()
    this.voice.onLevels(this.status.micLevelDb ?? -100, levelDb, 'sys')
    this.emitLevelsThrottled()
    this.hype.feed('system', levelDb)
  }

  private async pollGame() {
    const s = this.settings.get()
    const fg = await getForegroundApp(this.stickyGame?.pid ?? 0)
    let info = await toGameInfo(fg, s.allowlist, s.extraGames ?? [])
    // Remember the last real app (not the taskbar or Clutch), so the tray can offer "treat it as a game".
    if (info.process && info.name !== 'Desktop' && !/^(electron|clutch)$/i.test(info.process)) this.lastApp = info
    if (info.isGame && fg.pid) this.stickyGame = { info, pid: fg.pid }
    else if (this.stickyGame) {
      // Another (non-game) window has focus: stay on the game while it is still running.
      if (fg.watchedAlive) info = this.stickyGame.info
      else this.stickyGame = null
    }
    // Also when the same app becomes (or stops being) a game, e.g. after "Treat as a game".
    const changed = info.process !== this.game.process || !!info.isGame !== !!this.game.isGame
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
    if (s.app.autoStart === 'games' && info.isGame && !blocked && !this.status.running && !this.starting && !this.paused) {
      this.log('game', `Starting recording for ${info.name}`)
      if (await this.start('auto')) this.emit('autoStarted')
    } else if (this.autoStarted && (this.status.running || this.paused) && s.app.autoStopMinutes > 0 && Date.now() - this.lastGameSeenAt > s.app.autoStopMinutes * 60_000) {
      await this.stop('auto')
    }

    // Per-game profile switch while running (never in the middle of a long recording)
    if (changed && this.status.running && this.activeCapture && info.isGame && !this.long) {
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
  /** Apply the storage rules (size cap, delete after N days). Favorites are never touched. */
  tidyStorage() {
    const rules = this.settings.get().storage
    if (!rules) return
    const r = enforceStorage(this.library, rules)
    if (!r.removed) return
    const mb = Math.round(r.freedBytes / 1024 ** 2)
    const freed = mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
    const why = r.reason === 'size' ? `to stay under ${rules.maxGB} GB` : `older than ${rules.deleteAfterDays} days`
    this.log('info', `Removed ${r.removed} old clip${r.removed === 1 ? '' : 's'} ${why} (${freed} freed, favorites kept)`)
  }

  /**
   * Warn when the clips or recording drive runs low; pause recording before it fills completely,
   * since a full drive breaks the recording and can upset Windows.
   */
  private async checkDisk() {
    const s = this.settings.get()
    const dirs = [s.capture.outputDir, this.buffer.segmentDir].filter(Boolean)
    const free = Math.min(...dirs.map((d) => freeBytes(d) ?? Infinity))
    if (!Number.isFinite(free)) return
    const gb = free / 1024 ** 3
    const was = this.status.lowDisk
    const low = gb < (s.storage?.lowSpaceGB ?? 10)
    const critical = gb < 1.5
    this.status.lowDisk = low ? { freeGB: Math.round(gb * 10) / 10, critical } : undefined
    if (low && Date.now() - this.lastLowDiskNotice > 60 * 60_000) {
      this.lastLowDiskNotice = Date.now()
      this.log('error', `Only ${gb.toFixed(1)} GB free on the clips drive. Lower the storage limit or delete some clips.`)
    }
    if (critical && this.status.running && !this.paused) {
      this.log('error', 'Drive almost full - recording paused so it does not fill up')
      this.emit('notice', { title: 'Recording paused', sub: `Only ${gb.toFixed(1)} GB free on the clips drive`, kind: 'error' })
      await this.pause()
    }
    if (!!was !== !!this.status.lowDisk || was?.critical !== this.status.lowDisk?.critical) this.pushStatus()
  }

  /** Look through open windows for a game that is running but not in front (e.g. started before Clutch). */
  private async findAlreadyRunning() {
    const s = this.settings.get()
    if (this.scanning || this.stickyGame || this.game.isGame || this.status.running || this.starting || this.paused || s.app.autoStart !== 'games') return
    this.scanning = true
    try {
      const apps = await listRunningApps(s.extraGames ?? [], s.allowlist)
      const found = apps.find((a) => a.isGame && a.pid)
      if (!found || this.stickyGame || this.status.running) return
      await this.useGame(found, 'auto')
    } catch { /* try again next time */ } finally {
      this.scanning = false
    }
  }

  /**
   * Record this game, wherever its window is: "Pick a game" on Home, or the background scan.
   * The game becomes the remembered game, so focus can be anywhere.
   */
  async useGame(app: { process: string; title: string; exePath: string; pid?: number }, reason: 'manual' | 'auto' = 'manual') {
    const s = this.settings.get()
    const info: GameInfo = {
      name: gameNameFrom(app),
      process: app.process.toLowerCase(),
      exePath: app.exePath || undefined,
      icon: app.exePath ? await cachedIcon(app.process, app.exePath) : undefined,
      isGame: true
    }
    if (app.pid) this.stickyGame = { info, pid: app.pid }
    this.game = info
    this.lastGameSeenAt = Date.now()
    this.vision.reset()
    this.emit('game', info)
    this.status.recordingBlocked = this.recordingBlockedReason(s)
    this.log('game', reason === 'auto' ? `${info.name} is already running` : `Recording ${info.name}`)
    // Picking a game by hand also means "it is a game", so remember that for next time.
    if (reason === 'manual' && !(s.extraGames ?? []).includes(info.process)) {
      this.settings.set({ extraGames: [...(s.extraGames ?? []), info.process] })
      if (app.pid) this.stickyGame = { info, pid: app.pid }
    }
    if (this.status.recordingBlocked && reason === 'auto') { this.pushStatus(); return }
    if (this.status.running) {
      // Re-aim at the game window (game-window recording area).
      if (!this.long) { await this.buffer.stop(); await this.start(this.autoStarted ? 'auto' : 'manual') }
    } else if (await this.start(reason)) {
      if (reason === 'auto') this.emit('autoStarted')
    }
    this.pushStatus()
  }

  /** "This is a game": add an app Clutch missed, then re-check right away so recording can start. */
  treatAsGame(process: string) {
    const s = this.settings.get()
    const p = process.toLowerCase().replace(/\.exe$/, '')
    if (!p || (s.extraGames ?? []).includes(p)) return
    this.settings.set({ extraGames: [...(s.extraGames ?? []), p] })
    if (this.lastApp?.process === p) this.lastApp = { ...this.lastApp, isGame: true }
    this.log('game', `${this.lastApp?.process === p ? this.lastApp.name : p} will be treated as a game`)
    void this.pollGame()
  }

  /** The mic voice commands listen to: the first enabled mic source. */
  private commandMic(): string | undefined {
    const c = this.settings.get().capture
    return (c.audioSources ?? []).find((a) => a.kind === 'mic' && a.enabled && a.device)?.device ?? (c.micDevice || undefined)
  }

  /** Listen for spoken commands while recording (or during a test), otherwise not at all. */
  applyVoiceCommands() {
    if (Date.now() < this.voiceTestUntil) return
    const s = this.settings.get()
    const live = this.status.running || !!this.paused
    if (s.voiceCommands?.enabled && live) this.voiceCommands.start(s.voiceCommands, this.commandMic())
    else this.voiceCommands.stop()
  }

  /** "Try it": show what the recognizer hears for a few seconds, without running commands. */
  testVoiceCommands(seconds = 15) {
    const s = this.settings.get()
    this.voiceTestUntil = Date.now() + seconds * 1000
    this.voiceCommands.start(s.voiceCommands, this.commandMic(), { test: true })
    setTimeout(() => { this.voiceTestUntil = 0; this.voiceCommands.stop(); this.applyVoiceCommands() }, seconds * 1000)
    return { seconds, mic: this.commandMic() ?? null, unavailable: this.voiceCommands.unavailable }
  }

  async clipNow(trigger: TriggerSource = 'hotkey', seconds?: number) {
    const c = this.effectiveCapture()
    const back = Math.min(seconds ?? c.preSeconds, c.bufferSeconds)
    // Paused: nothing new is coming, so clip the moments right before the pause.
    if (this.paused) return this.clipRange(this.paused.at - back * 1000, this.paused.at, trigger)
    const now = Date.now()
    return this.clipRange(now - back * 1000, now + c.postSeconds * 1000, trigger)
  }

  get longRecording() {
    return this.long
  }

  /** Full-session recording: keep every segment from now until it is stopped, then save one file. */
  async startLong() {
    if (this.long) return
    if (this.paused) await this.resume()
    if (!this.status.running) await this.start('manual')
    if (!this.buffer.running) {
      this.emit('notice', { title: 'Could not start recording', sub: 'Check the Home page for details', kind: 'error' })
      return
    }
    const startMs = Date.now()
    this.long = { startMs, bookmarks: [], game: this.game, pauses: [] }
    this.buffer.holdFromMs = startMs
    this.status.longRecording = { since: new Date(startMs).toISOString(), bookmarks: 0, game: this.game.name }
    const keys = this.settings.get().capture
    this.log('info', `Long recording started${this.game.isGame ? ` in ${this.game.name}` : ''}`)
    this.emit('notice', { title: 'Long recording started', sub: [keys.bookmarkHotkey && `${keys.bookmarkHotkey} bookmark`, keys.longRecordHotkey && `${keys.longRecordHotkey} stop`].filter(Boolean).join(' · '), kind: 'info' })
    this.pushStatus()
  }

  async stopLong(): Promise<Clip | undefined> {
    const l = this.long
    if (!l) return
    this.long = null
    this.status.longRecording = undefined
    this.pushStatus()
    const endMs = this.paused?.at ?? Date.now()
    const pauses = this.paused ? [...l.pauses, { from: this.paused.at, to: endMs }] : l.pauses
    const pausedMs = pauses.reduce((n, x) => n + (x.to - x.from), 0)
    const mins = Math.round((endMs - l.startMs - pausedMs) / 60000)
    this.emit('notice', { title: 'Saving long recording…', sub: `${mins < 1 ? 'Under a minute' : `${mins} min`}${l.bookmarks.length ? ` · ${l.bookmarks.length} bookmark${l.bookmarks.length > 1 ? 's' : ''}` : ''}`, kind: 'info' })
    const c = this.settings.get().capture
    const safeGame = l.game.name.replace(/[^\w\- ]+/g, '').trim() || 'Recording'
    const stamp = new Date(l.startMs).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const outFile = path.join(c.outputDir, safeGame, `${safeGame} Long ${stamp}.mp4`)
    try {
      const { file, actualStartMs } = await this.buffer.saveRange({ startMs: l.startMs, endMs, outFile, allowStopped: !!this.paused })
      // Paused stretches are not in the file, so bookmarks after a pause move back by its length.
      const pausedBefore = (t: number) => pauses.reduce((n, x) => n + (x.to <= t ? x.to - x.from : 0), 0)
      const bookmarks = l.bookmarks.map((b) => Math.max(0, (b - actualStartMs - pausedBefore(b)) / 1000))
      const clip = await this.library.add(file, { game: l.game.name, gameProcess: l.game.process || undefined, gameIcon: l.game.icon, trigger: 'long', title: `${l.game.isGame ? l.game.name : 'Session'} · ${new Date(l.startMs).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, bookmarks })
      const len = `${Math.floor(clip.durationSec / 60)}:${String(Math.round(clip.durationSec % 60)).padStart(2, "0")}`
      this.log('clip', `Saved long recording "${clip.title}" (${len}, ${bookmarks.length} bookmark${bookmarks.length === 1 ? "" : "s"})`, clip.id)
      this.emit('clip', clip)
      return clip
    } catch (e) {
      this.log('error', `Long recording could not be saved: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.buffer.holdFromMs = null
    }
  }

  async toggleLong() {
    return this.long ? this.stopLong() : this.startLong()
  }

  /** Mark this moment in the running long recording. */
  bookmark() {
    const keys = this.settings.get().capture
    if (!this.long) {
      this.emit('notice', { title: 'No long recording running', sub: keys.longRecordHotkey ? `Press ${keys.longRecordHotkey} to start one, then bookmark` : 'Start a long recording first', kind: 'info' })
      return
    }
    this.long.bookmarks.push(Date.now())
    const n = this.long.bookmarks.length
    const t = Math.round((Date.now() - this.long.startMs - this.long.pauses.reduce((n, x) => n + (x.to - x.from), 0)) / 1000)
    this.status.longRecording = { ...this.status.longRecording!, bookmarks: n }
    this.emit('notice', { title: `Bookmark ${n}`, sub: `at ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} in this recording`, kind: 'clip' })
    this.pushStatus()
  }

  private lastLevelEmit = 0
  private emitLevelsThrottled() {
    const now = Date.now()
    if (now - this.lastLevelEmit < 100) return
    this.lastLevelEmit = now
    this.emit('levels', { micDb: this.status.micLevelDb ?? -100, sysDb: this.status.systemLevelDb ?? -100, sources: {} })
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

  /**
   * Automatic triggers (hype, voice, AI) only clip while a game is being recorded, like Medal.
   * Recording the desktop on purpose still works with the hotkey; it just doesn't clip by itself
   * whenever you talk or a video plays.
   */
  private autoClipAllowed(): boolean {
    return !!(this.game.isGame || this.stickyGame || this.long?.game.isGame)
  }

  async clipRange(startMs: number, endMs: number, trigger: TriggerSource, meta: { event?: string; title?: string; hypeDb?: number } = {}) {
    if (!this.buffer.running && !this.paused) {
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
      const { file } = await this.buffer.saveRange({ startMs, endMs, outFile, allowStopped: !!this.paused })
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

  private makeVision(s: Settings) {
    return new VisionJudge(s.ai.anthropicApiKey, s.vision.model || 'claude-haiku-5-5', this.cloudJudge)
  }

  /** Screen watching through the Clutch account (set by the main process while signed in). */
  setCloudVision(fn: CloudJudge | null) {
    this.cloudJudge = fn
    this.vision = this.makeVision(this.settings.get())
    this.applyWatching()
  }

  /** Turn snapshots on/off to match "enabled and has somewhere to send them". No restart needed. */
  private applyWatching() {
    const s = this.settings.get()
    const watching = s.vision.enabled && this.vision.ready
    this.buffer.snapshotIntervalSec = s.vision.intervalSeconds
    this.status.vision = watching ? { destination: this.vision.destination, checks: this.visionStats.checks, skipped: this.visionStats.skipped } : undefined
    if (watching === this.watching) return
    this.watching = watching
    this.buffer.setSnapshots(watching)
    if (this.status.running) this.log('info', watching ? `Screen watching on (${this.vision.destination === 'clutch' ? 'through your Clutch account' : 'with your AI key'})` : 'Screen watching off')
    this.pushStatus()
  }

  /** How different this frame is from the last one (0 = same, 1 = completely different). Tiny and on-PC. */
  private frameChange(jpeg: Buffer): number {
    const img = nativeImage.createFromBuffer(jpeg)
    if (img.isEmpty()) return 1
    const px = img.resize({ width: 32, height: 18, quality: 'good' }).toBitmap()
    const lum = new Float32Array(32 * 18)
    for (let i = 0; i < lum.length; i++) lum[i] = 0.114 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.299 * px[i * 4 + 2]
    const prev = this.lastLum
    this.lastLum = lum
    if (!prev) return 1
    let diff = 0
    for (let i = 0; i < lum.length; i++) diff += Math.abs(lum[i] - prev[i])
    return diff / lum.length / 255
  }

  private async onSnapshot(jpeg: Buffer) {
    const s = this.settings.get()
    if (!s.vision.enabled || !this.vision.ready || this.status.recordingBlocked || !this.autoClipAllowed()) return
    if (Date.now() - this.lastVisionClipAt < VISION_COOLDOWN_MS) { this.vision.remember(jpeg); this.frameChange(jpeg); return }
    // Cheap checks first: only ask the AI when the screen changed a lot or the audio got loud.
    // Menus, walking around and lobbies cost nothing.
    const change = this.frameChange(jpeg)
    const loud = Date.now() - this.lastLoudAt < 5000
    const now = Date.now()
    this.visionCalls = this.visionCalls.filter((t) => now - t < 60_000)
    const underCap = this.visionCalls.length < Math.max(1, s.vision.maxPerMinute || 6)
    if (!(change > 0.06 || loud) || !underCap) {
      this.vision.remember(jpeg)
      this.visionStats.skipped++
      if (this.status.vision) this.status.vision = { ...this.status.vision, skipped: this.visionStats.skipped }
      return
    }
    this.visionCalls.push(now)
    this.visionStats.checks++
    if (this.status.vision) this.status.vision = { ...this.status.vision, checks: this.visionStats.checks }
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
    if (this.scanTimer) clearInterval(this.scanTimer)
    if (this.storageTimer) clearInterval(this.storageTimer)
    if (this.diskTimer) clearInterval(this.diskTimer)
    if (this.statusTimer) clearInterval(this.statusTimer)
  }
}
