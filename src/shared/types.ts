// Types shared between the main process and the renderer.

/** What part of the screen to record. Region coordinates are physical pixels on the chosen monitor. */
export type CaptureArea =
  | { kind: 'monitor' }
  | { kind: 'game' }
  | { kind: 'window'; process: string; title: string }
  | { kind: 'region'; x: number; y: number; w: number; h: number; label?: string }

/** One audio input. Every enabled source is mixed into track 1; `ownTrack` also keeps it on its own track. */
export interface AudioSource {
  id: string
  kind: 'mic' | 'desktop' | 'app'
  /** DirectShow device name (mics, virtual cables, capture cards). */
  device?: string
  /** For 'app': the program to capture, e.g. "discord" (its child processes are included). */
  process?: string
  /** For 'app': also add it to the main mix. Off by default, since game & voice chat audio already contains it. */
  inMix?: boolean
  name: string
  enabled: boolean
  /** 1 = 100 %. 0 .. 2. */
  volume: number
  ownTrack: boolean
  /** Counts as "my mic" for the voice and hype triggers. */
  trigger?: boolean
}

export type Encoder = 'auto' | 'h264_nvenc' | 'hevc_nvenc' | 'av1_nvenc' | 'h264_amf' | 'h264_qsv' | 'libx264'

export interface CaptureSettings {
  fps: 30 | 60 | 120 | 144
  /** 1 = native, 0.5 = half resolution, etc. */
  resolutionScale: 1 | 0.75 | 0.5
  encoder: Encoder
  /** Constant-quality value. Lower = better. NVENC: 15 (max) .. 35 (low). */
  quality: number
  /** Seconds kept in the replay buffer. */
  bufferSeconds: number
  /** Seconds before the trigger to include in a clip. */
  preSeconds: number
  /** Seconds after the trigger to include in a clip. */
  postSeconds: number
  /** Monitor index for ddagrab. */
  monitorIndex: number
  /** Whole monitor, the game's window, a chosen window, or a custom area. */
  area: CaptureArea
  /** Audio inputs (mics + system audio), mixed into one track with optional separate tracks. */
  audioSources: AudioSource[]
  /** Derived from audioSources: first enabled mic. Kept for simple screens like onboarding. */
  micDevice: string
  /** Capture system/desktop audio through Electron loopback. */
  systemAudio: boolean
  outputDir: string
  clipHotkey: string
  /** More clip hotkeys, each saving its own length, e.g. Shift+F8 = 60 s. */
  extraHotkeys: { key: string; seconds: number }[]
  /** Change the clip length from inside a game. */
  lengthUpHotkey: string
  lengthDownHotkey: string
  /** Steps the length hotkeys move through (seconds). */
  lengthPresets: number[]
  /** Start/stop a full-session recording (NVIDIA-style). */
  longRecordHotkey: string
  /** Mark a moment during a long recording (Medal-style). */
  bookmarkHotkey: string
}

/** Per-game overrides of the capture settings. Keyed by lower-case process name. */
export type GameProfile = Partial<Pick<CaptureSettings, 'fps' | 'quality' | 'resolutionScale' | 'preSeconds' | 'postSeconds'>> & {
  /** Display name shown in the UI. */
  name: string
}

export interface VisionRules {
  enabled: boolean
  /** Plain-English instructions, e.g. "Clip my kills and headshots. Never clip menus or loading screens." */
  rules: string
  /** Seconds between frame checks. */
  intervalSeconds: number
  /** 0..1 - minimum confidence to save a clip. */
  minConfidence: number
  /** Model for screen watching. A small, cheap one: it runs many times per session. */
  model: string
  /** Most AI checks per minute (the cheap on-PC checks decide which moments get one). */
  maxPerMinute: number
}

export interface VoiceRules {
  enabled: boolean
  /** Clip when mic or voice chat is active. */
  onMic: boolean
  onSystemAudio: boolean
  /** dBFS threshold, e.g. -30. */
  thresholdDb: number
  /** Seconds of continuous speech before a clip is started. */
  minSpeechSeconds: number
  /** Seconds of silence that ends a "talking" clip. */
  silenceSeconds: number
  /** Hard cap for one talking clip. */
  maxClipSeconds: number
}

export interface UploadSettings {
  youtube: {
    clientId: string
    clientSecret: string
    connected: boolean
    /** 'account': through the Clutch server (one click). 'own': the user's own Google OAuth app. */
    via?: 'account' | 'own'
    channelTitle?: string
    privacy: 'private' | 'unlisted' | 'public'
    titleTemplate: string
    descriptionTemplate: string
    tags: string[]
  }
  /** Auto-upload schedule: "HH:MM" entries in local time, one upload per slot. */
  schedule: { enabled: boolean; times: string[]; source: 'favorites' | 'tag'; tag: string; platforms: Platform[] }
}

export type Platform = 'youtube' | 'tiktok' | 'twitch'

export interface AISettings {
  anthropicApiKey: string
  model: string
  /** Give new clips a short title from their thumbnail (one small API call per clip). */
  autoTitle: boolean
}

/** Non-AI "hype" trigger: a sudden loudness spike on mic / voice chat (yelling, laughing). */
export interface HypeRules {
  enabled: boolean
  onMic: boolean
  onSystemAudio: boolean
  /** dB above the rolling average that counts as a spike. */
  spikeDb: number
  /** Minimum absolute level for a spike (ignore quiet rooms). */
  minDb: number
}

export interface DiscordSettings {
  /** Channel webhook URL from Discord → channel settings → Integrations → Webhooks. */
  webhookUrl: string
  /** Attachment size limit of the server (10 MB for most servers, 50/100 MB with boosts). */
  maxMb: number
  /** Post the best clip of the day automatically. */
  dailyDigest: { enabled: boolean; time: string }
  /** Mention text added to posts, e.g. "@everyone". */
  mention: string
}

/**
 * The official Clutch cloud server. Leave empty until you deploy server/ somewhere;
 * people can also point the app at their own server under Settings → Account.
 */
export const OFFICIAL_CLOUD_URL = ''

export interface CloudSettings {
  /** Clutch cloud server URL (sign-in, share links, cloud storage, Pro). */
  serverUrl: string
  /** Pro: upload favorited clips to the cloud automatically. */
  backupFavorites: boolean
}

export interface PlanFeatures {
  shareLinks: boolean
  cloudBackup: boolean
  autoUploadSlots: number
  autoUploadPlatforms: number
  adFree: boolean
  /** Smart reads of settings screenshots per day (cloud AI). */
  smartReadsPerDay?: number
  /** Screen-watching AI checks per day through the account. */
  visionChecksPerDay?: number
}

export interface AccountState {
  signedIn: boolean
  serverUrl: string
  user?: { id: string; name: string; avatar?: string | null; provider: string; email?: string | null }
  plan?: { id: 'free' | 'pro'; name: string; until: number | null; storageBytes: number; maxClipBytes: number; linkDays: number; features: PlanFeatures }
  usage?: { bytes: number }
  billing?: { enabled: boolean; hasSubscription: boolean }
  error?: string
}

export interface AdCard {
  id: string
  title: string
  body: string
  cta: string
  /** https link, or clutch://pro for the in-app Pro page. */
  url: string
  image?: string
  sponsor?: string
  placements?: string[]
}

/** Shown when no cloud server is reachable, so the slot never breaks. */
export const HOUSE_ADS: (AdCard & { placements: string[] })[] = [
  { id: 'pro-upgrade', placements: ['home', 'library'], title: 'Clutch Pro', body: '100 GB of cloud clips, share links that never expire, and no sponsored cards.', cta: 'See Pro', url: 'clutch://pro', sponsor: 'Clutch' },
  { id: 'star-github', placements: ['home', 'library'], title: 'Clutch is open source', body: 'Star the project on GitHub, report bugs, or build a feature yourself.', cta: 'Open GitHub', url: 'https://github.com/KofiFS/clutch', sponsor: 'Clutch' }
]

/** Plan comparison shown in the app (the server enforces the cloud limits). */
export const PLAN_ROWS: { label: string; free: string; pro: string }[] = [
  { label: 'Recording, hotkeys, triggers, editor', free: 'Unlimited', pro: 'Unlimited' },
  { label: 'Discord + manual YouTube uploads', free: 'Yes', pro: 'Yes' },
  { label: 'Cloud storage', free: '2 GB', pro: '100 GB' },
  { label: 'Share links', free: 'Kept 30 days', pro: 'Never expire' },
  { label: 'Biggest clip to share', free: '100 MB', pro: '1 GB' },
  { label: 'Auto-upload schedule', free: '1 time a day', pro: 'Up to 12 a day' },
  { label: 'Back up favorites to the cloud', free: '—', pro: 'Automatic' },
  { label: 'Smart import of Medal / OBS screenshots', free: '3 a day', pro: '25 a day' },
  { label: 'Screen watching ("clip my kills") without an AI key', free: '60 checks a day', pro: '800 a day' },
  { label: 'Sponsored cards', free: 'Optional (can turn off)', pro: 'Never' }
]

/**
 * A game's display name without technical tags from its window title, so "Rocket League (64-bit,
 * DX11, Cooked)" and Medal's "Rocket League" folder are the same game.
 */
export function cleanGameName(name: string): string {
  const tech = /\b(64-?bit|32-?bit|x64|x86|dx ?\d+|directx ?\d*|vulkan|opengl|d3d\d*|shipping|cooked|win(64|32)|development|debug|release|test build)\b/i
  let n = name.trim()
  for (let i = 0; i < 3; i++) {
    const m = n.match(/\s*[(\[]([^()[\]]*)[)\]]\s*$/)
    if (!m || !tech.test(m[1])) break
    n = n.slice(0, m.index).trim()
  }
  return n || name.trim()
}

export type VoiceCommandAction = 'clip' | 'bookmark' | 'long'

export interface VoiceCommandSettings {
  enabled: boolean
  /** 0..1: how sure the recognizer must be. Higher = fewer accidental clips, may miss mumbles. */
  minConfidence: number
  commands: { phrase: string; action: VoiceCommandAction }[]
}

/** Self-update status (installed app, from GitHub Releases). */
export interface UpdateState {
  phase: 'idle' | 'unsupported' | 'checking' | 'downloading' | 'up-to-date' | 'ready' | 'error'
  /** The version running now. */
  current: string
  /** The new version being downloaded or ready to install. */
  version?: string
  /** Download progress 0..1. */
  progress?: number
  /** When the last check finished. */
  checkedAt?: string
  /** Why updates are off, or what went wrong. */
  message?: string
}

export interface AppBehavior {
  /** First-run wizard completed. */
  onboarded: boolean
  /** Closing the window hides to the tray instead of quitting. */
  minimizeToTray: boolean
  /** Launch minimized to the tray. */
  startMinimized: boolean
  /** Show a small always-on-top "Clipped!" overlay on screen when a clip is saved. */
  overlayToasts: boolean
  /** Play a short sound when a clip is saved. */
  clipSound: boolean
  /** Automatically start the replay buffer when a game comes to the front. */
  autoStart: 'off' | 'games'
  /** Stop the buffer this many minutes after the last game closed (0 = never). */
  autoStopMinutes: number
  /** Keep deleted clips in a trash folder so they can be restored. */
  useTrash: boolean
  /** 'full' = liquid glass blur + HUD effects; 'lite' = solid panels for weaker PCs. */
  effects: 'full' | 'lite'
  /** Windows 11 acrylic: the desktop shows through the window, frosted. */
  windowGlass: boolean
  /** Launch hidden in the tray when Windows starts. */
  launchAtLogin: boolean
  /** The "still running in the tray" notice was shown once. */
  trayHintShown: boolean
  /** Show sponsored cards on Home and Clips (never in game). Supports development; free to turn off. */
  showAds: boolean
  /** When recording starts, shrink Clutch to a small controller in the corner (hidden from clips). */
  miniWidget: boolean
  /** Where the user dragged the controller to (its top-right corner, screen DIP). */
  miniWidgetAnchor?: { right: number; top: number } | null
}

/** Keeps the clip library from filling the drive. 0 turns a rule off. Favorites are never deleted. */
export interface StorageRules {
  /** Keep all clips (trash included) under this many GB; the oldest non-favorites go first. */
  maxGB: number
  /** Delete non-favorite clips older than this many days. */
  deleteAfterDays: number
  /** Warn when the clips or recording drive has less than this much free space (GB). */
  lowSpaceGB: number
  /** Storage saver: re-encode clips to AV1/HEVC in the background to take far less space. */
  shrink?: 'auto' | 'off'
  /** Shrink clips this many days after recording (0 = as soon as Clutch is idle). */
  shrinkAfterDays?: number
  /** When automatic shrinking was turned on; older clips are only shrunk on request. */
  shrinkSince?: number | null
}

export interface ShrinkProgress {
  running: boolean
  done: number
  total: number
  savedBytes: number
}

export interface Settings {
  storage: StorageRules
  capture: CaptureSettings
  vision: VisionRules
  voice: VoiceRules
  /** Spoken commands like "clip that" (offline, Windows speech recognition). */
  voiceCommands: VoiceCommandSettings
  upload: UploadSettings
  cloud: CloudSettings
  discord: DiscordSettings
  hype: HypeRules
  ai: AISettings
  app: AppBehavior
  /** Games (process names) never recorded, e.g. ["discord.exe"]. */
  blocklist: string[]
  /** Apps Clutch should treat as games although it doesn't detect them (process names). Limits nothing else. */
  extraGames: string[]
  /** If non-empty, only record when one of these processes is in the foreground. */
  allowlist: string[]
  /** Per-game capture overrides. */
  profiles: Record<string, GameProfile>
  startBufferOnLaunch: boolean
  /** Other clip folders shown next to Clutch's own clips (Medal, OBS, any folder). Read in place. */
  libraries: LibrarySource[]
}

/**
 * A folder of videos from another app (or anywhere) that Clutch lists without copying. Clutch
 * never deletes, moves or shrinks files in it: removing a clip only hides it from Clutch.
 */
export interface LibrarySource {
  id: string
  name: string
  /** Folder that holds the videos (subfolders are scanned; a first-level subfolder is the game). */
  path: string
  /** 'medal' adds Medal-specific touches (file-name dates, "Screen Recording" as Desktop). */
  kind: 'folder' | 'medal'
  addedAt: string
}

/** A library as the UI shows it, with what's in it right now. */
export interface LibraryInfo extends LibrarySource {
  count: number
  bytes: number
  /** Folder can't be read right now (unplugged drive, deleted, no permission). */
  missing: boolean
  scanning?: { done: number; total: number }
}

export type TriggerSource = 'hotkey' | 'vision' | 'voice' | 'hype' | 'manual' | 'long'

export interface Clip {
  id: string
  /** Set once the storage saver has handled this clip (codec 'av1'/'hevc', or why it was left alone). */
  shrunk?: { codec: string; fromBytes: number; at: string }
  file: string
  thumbnail: string
  createdAt: string
  durationSec: number
  sizeBytes: number
  game: string
  /** Lower-case process name of the game, for icons and profiles. */
  gameProcess?: string
  /** Cached icon path (png) for the game, if we could extract one. */
  gameIcon?: string
  title: string
  trigger: TriggerSource
  /** What the vision model said happened, if anything. */
  event?: string
  tags: string[]
  favorite: boolean
  width: number
  height: number
  fps: number
  uploads: UploadRecord[]
  /** Set while the clip sits in the trash. */
  trashedAt?: string
  /** Peak loudness (dBFS) around the trigger; used for "clip of the day" scoring. */
  hypeDb?: number
  /** Posted to Discord at these times. */
  discordPosts?: string[]
  /** Times the clip was opened in the viewer. */
  views?: number
  /** Bookmarked moments in a long recording, seconds from the start. */
  bookmarks?: number[]
  /** Set once the clip is in the Clutch cloud. */
  cloud?: { id: string; shareUrl: string; uploadedAt: string; expires: number | null }
  /** Id of the LibrarySource this video lives in. Unset for clips Clutch recorded itself. */
  source?: string
}

export interface UploadRecord {
  id: string
  platform: Platform
  status: 'queued' | 'uploading' | 'done' | 'failed'
  scheduledAt: string
  progress: number
  url?: string
  error?: string
  /** Per-upload overrides of the template values. */
  title?: string
  description?: string
  tags?: string[]
  privacy?: 'private' | 'unlisted' | 'public'
}

export interface MonitorInfo {
  index: number
  label: string
  width: number
  height: number
  primary: boolean
}

export interface GameInfo {
  name: string
  process: string
  exePath?: string
  icon?: string
  fullscreen?: boolean
  isGame?: boolean
}

export interface BufferStatus {
  running: boolean
  starting?: boolean
  since?: string
  encoder?: string
  game?: string
  gameInfo?: GameInfo
  fps?: number
  resolution?: string
  /** Human description of what is being captured, e.g. "Valorant window" or "Custom area 2560x1440". */
  areaLabel?: string
  lastError?: string
  micLevelDb?: number
  systemLevelDb?: number
  systemAudioActive?: boolean
  visionLastCheck?: string
  visionLastVerdict?: string
  recordingBlocked?: string
  hotkeyRegistered?: boolean
  /** Seconds currently available in the buffer. */
  bufferedSeconds?: number
  talking?: boolean
  /** Set while a long (full-session) recording is running. */
  longRecording?: { since: string; bookmarks: number; game: string }
  /** Screen watching: where frames go, and how many AI checks ran vs. were skipped this session. */
  vision?: { destination: 'anthropic' | 'clutch' | null; checks: number; skipped: number }
  /** Set when the clips or recording drive is low on space. */
  lowDisk?: { freeGB: number; critical: boolean }
  /** Set while recording is paused (nothing captured, buffer kept). `since` then counts recorded time only. */
  paused?: { since: string }
}

export interface ActivityEvent {
  at: string
  kind: 'info' | 'clip' | 'error' | 'vision' | 'voice' | 'hype' | 'upload' | 'game' | 'discord'
  message: string
  clipId?: string
}

export interface HealthItem {
  id: string
  label: string
  ok: boolean | 'warn'
  detail: string
  fix?: 'settings' | 'rules' | 'uploads'
  /** Title of the setting the Fix button scrolls to on that page. */
  fixFind?: string
}

export interface AudioDevice {
  name: string
}

export const DEFAULT_SETTINGS: Settings = {
  capture: {
    fps: 60,
    resolutionScale: 1,
    encoder: 'auto',
    quality: 23,
    bufferSeconds: 120,
    preSeconds: 20,
    postSeconds: 5,
    monitorIndex: 0,
    // Only the game's window, so browsers, chats and notifications elsewhere stay out of clips.
    area: { kind: 'game' },
    audioSources: [],
    micDevice: '',
    systemAudio: true,
    outputDir: '',
    clipHotkey: 'F9',
    extraHotkeys: [],
    lengthUpHotkey: 'Alt+PageUp',
    lengthDownHotkey: 'Alt+PageDown',
    lengthPresets: [10, 20, 30, 60, 120],
    longRecordHotkey: 'Alt+F9',
    bookmarkHotkey: 'Alt+F8'
  },
  vision: {
    enabled: false,
    rules: 'Clip kills, multi-kills, goals, clutch moments and funny physics. Do not clip menus, lobbies, loading screens or scoreboards.',
    intervalSeconds: 3,
    minConfidence: 0.7,
    model: 'claude-haiku-5-5',
    maxPerMinute: 6
  },
  voiceCommands: {
    enabled: true,
    minConfidence: 0.55,
    commands: [
      { phrase: 'clip that', action: 'clip' },
      { phrase: 'bookmark that', action: 'bookmark' }
    ]
  },
  voice: {
    enabled: false,
    onMic: true,
    onSystemAudio: true,
    thresholdDb: -32,
    minSpeechSeconds: 1.5,
    silenceSeconds: 4,
    maxClipSeconds: 60
  },
  upload: {
    youtube: {
      clientId: '',
      clientSecret: '',
      connected: false,
      privacy: 'private',
      titleTemplate: '{game} - {title}',
      descriptionTemplate: 'Recorded with Clutch',
      tags: ['gaming', 'clips']
    },
    schedule: { enabled: false, times: ['18:00'], source: 'favorites', tag: 'upload', platforms: ['youtube'] }
  },
  discord: { webhookUrl: '', maxMb: 10, dailyDigest: { enabled: false, time: '20:00' }, mention: '' },
  hype: { enabled: true, onMic: true, onSystemAudio: false, spikeDb: 18, minDb: -20 },
  ai: { anthropicApiKey: '', model: 'claude-opus-5-5', autoTitle: false },
  app: {
    onboarded: false,
    minimizeToTray: true,
    startMinimized: false,
    overlayToasts: true,
    clipSound: true,
    autoStart: 'games',
    autoStopMinutes: 5,
    useTrash: true,
    effects: 'full',
    windowGlass: false,
    launchAtLogin: false,
    trayHintShown: false,
    showAds: true,
    miniWidget: true,
    miniWidgetAnchor: null
  },
  cloud: { serverUrl: OFFICIAL_CLOUD_URL, backupFavorites: true },
  blocklist: [],
  extraGames: [],
  libraries: [],
  storage: { maxGB: 100, deleteAfterDays: 0, lowSpaceGB: 10, shrink: 'auto', shrinkAfterDays: 1, shrinkSince: null },
  allowlist: [],
  profiles: {},
  startBufferOnLaunch: false
}

export const QUALITY_PRESETS: { id: string; name: string; desc: string; capture: Partial<CaptureSettings> }[] = [
  { id: 'best', name: 'Best quality', desc: 'Native resolution, CQ 19. Big files, looks perfect.', capture: { resolutionScale: 1, quality: 19, fps: 60 } },
  { id: 'balanced', name: 'Balanced', desc: 'Native resolution, CQ 23. Great for YouTube.', capture: { resolutionScale: 1, quality: 23, fps: 60 } },
  { id: 'small', name: 'Small files', desc: '75% resolution, CQ 27. Easy to share.', capture: { resolutionScale: 0.75, quality: 27, fps: 60 } },
  { id: 'smooth', name: 'High frame rate', desc: 'Native, 120 fps, CQ 23. For slow-mo and shooters.', capture: { resolutionScale: 1, quality: 23, fps: 120 } }
]

export interface RunningApp {
  process: string
  title: string
  exePath: string
  icon?: string
  pid?: number
  /** Clutch would treat it as a game (install folder, your lists). */
  isGame?: boolean
}

export interface GameSummary {
  name: string
  process?: string
  icon?: string
  count: number
}

/** Settings read from another recorder (a screenshot of its settings, or OBS's files). */
export interface ImportedSettings {
  /** "Medal", "OBS", "NVIDIA App"... or "another recorder". */
  app: string
  fps?: number
  /** Output height in pixels, or 'native'. */
  outputHeight?: number | 'native'
  quality?: 'low' | 'medium' | 'high' | 'max'
  bitrateMbps?: number
  /** Replay buffer length. */
  bufferSeconds?: number
  /** Total clip length. */
  clipSeconds?: number
  /** Electron accelerator, e.g. "Alt+F10". */
  hotkey?: string
  saveFolder?: string
  /** Mic device name as the other app shows it; null = mic turned off there. */
  mic?: string | null
  systemAudio?: boolean
  /** Things worth telling the user (unreadable fields, devices not on this PC). */
  notes: string[]
}

/** One proposed change, shown with a checkbox before anything is applied. */
export interface ImportChange {
  id: string
  label: string
  from: string
  to: string
  patch: Partial<CaptureSettings>
  warn?: string
  /** Ticked by default. */
  on: boolean
}

export interface ImportResult {
  found: ImportedSettings
  changes: ImportChange[]
  /** How the screenshot was read. */
  via: 'text' | 'smart' | 'obs-files'
  /** Lines of text recognized (0 means the picture had no readable text). */
  lines?: number
}

/** Export options for the clip editor (crop / reframe, speed, captions). */
export interface EditOptions {
  /** Trimmed range in seconds; whole clip when omitted. */
  start?: number
  end?: number
  format: 'original' | 'vertical' | 'square' | 'wide'
  /** For non-original formats: crop to the frame, or fit the whole picture over a blurred copy. */
  fit: 'crop' | 'blur'
  /** Crop frame position, 0..1 (0.5 = centered). */
  cropX?: number
  cropY?: number
  /** 0.25 .. 4 */
  speed: number
  /** Burn in automatic captions (speech-to-text on this PC). */
  captions: boolean
  /** Audio volume of the export, 1 = unchanged (0 .. 3). */
  volume?: number
}
