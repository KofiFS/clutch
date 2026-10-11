// Types shared between the main process and the renderer.

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
  /** dshow microphone device name, or '' to disable. */
  micDevice: string
  /** Capture system/desktop audio through Electron loopback. */
  systemAudio: boolean
  outputDir: string
  clipHotkey: string
}

export interface VisionRules {
  enabled: boolean
  /** Plain-English instructions, e.g. "Clip my kills and headshots. Never clip menus or loading screens." */
  rules: string
  /** Seconds between frame checks. */
  intervalSeconds: number
  /** 0..1 - minimum confidence to save a clip. */
  minConfidence: number
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
}

export interface Settings {
  capture: CaptureSettings
  vision: VisionRules
  voice: VoiceRules
  upload: UploadSettings
  ai: AISettings
  /** Games (process names) never recorded, e.g. ["discord.exe"]. */
  blocklist: string[]
  /** If non-empty, only record when one of these processes is in the foreground. */
  allowlist: string[]
  startBufferOnLaunch: boolean
}

export type TriggerSource = 'hotkey' | 'vision' | 'voice' | 'manual'

export interface Clip {
  id: string
  file: string
  thumbnail: string
  createdAt: string
  durationSec: number
  sizeBytes: number
  game: string
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
}

export interface UploadRecord {
  id: string
  platform: Platform
  status: 'queued' | 'uploading' | 'done' | 'failed'
  scheduledAt: string
  progress: number
  url?: string
  error?: string
}

export interface BufferStatus {
  running: boolean
  since?: string
  encoder?: string
  game?: string
  fps?: number
  resolution?: string
  lastError?: string
  micLevelDb?: number
  systemLevelDb?: number
  visionLastCheck?: string
  visionLastVerdict?: string
  recordingBlocked?: string
}

export interface ActivityEvent {
  at: string
  kind: 'info' | 'clip' | 'error' | 'vision' | 'voice' | 'upload'
  message: string
}

export interface AudioDevice { name: string }

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
    micDevice: '',
    systemAudio: true,
    outputDir: '',
    clipHotkey: 'F8'
  },
  vision: {
    enabled: false,
    rules: 'Clip kills, multi-kills, goals, clutch moments and funny physics. Do not clip menus, lobbies, loading screens or scoreboards.',
    intervalSeconds: 3,
    minConfidence: 0.7
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
      descriptionTemplate: 'Recorded with ClipForge',
      tags: ['gaming', 'clips']
    },
    schedule: { enabled: false, times: ['18:00'], source: 'favorites', tag: 'upload', platforms: ['youtube'] }
  },
  ai: { anthropicApiKey: '', model: 'claude-opus-5-5' },
  blocklist: [],
  allowlist: [],
  startBufferOnLaunch: false
}
