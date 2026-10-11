import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, type AudioSource, type Settings } from '../shared/types'

/** Tiny JSON settings store. Deep-merges saved values over the defaults so new keys never go missing. */
export class SettingsStore {
  private file: string
  private data: Settings
  private listeners = new Set<(s: Settings) => void>()

  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json')
    this.data = this.load()
    this.data = syncAudio(this.data, this.data)
    // Renamed from ClipForge: update the untouched default upload description.
    if (this.data.upload.youtube.descriptionTemplate === 'Recorded with ClipForge') this.data.upload.youtube.descriptionTemplate = 'Recorded with Clutch'
    if (!this.data.capture.outputDir) {
      this.data.capture.outputDir = path.join(app.getPath('videos'), 'Clutch')
    }
  }

  private load(): Settings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return deepMerge(structuredClone(DEFAULT_SETTINGS), raw) as Settings
    } catch {
      return structuredClone(DEFAULT_SETTINGS)
    }
  }

  get(): Settings {
    return this.data
  }

  set(patch: Partial<Settings>): Settings {
    const prev = this.data
    this.data = syncAudio(prev, deepMerge(prev, patch) as Settings)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    for (const l of this.listeners) l(this.data)
    return this.data
  }

  onChange(fn: (s: Settings) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObj(base) || !isObj(patch)) return patch === undefined ? base : patch
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v
  }
  return out
}

/**
 * audioSources is the source of truth; micDevice / systemAudio mirror it for simple screens.
 * If a simple screen changed micDevice or systemAudio (and left audioSources alone), apply that
 * change to the sources instead. Also migrates settings from before audio sources existed.
 */
export function syncAudio(prev: Settings, next: Settings): Settings {
  const c = { ...next.capture }
  let sources: AudioSource[] = (c.audioSources ?? []).map((x) => ({ ...x }))
  const sourcesChanged = JSON.stringify(sources) !== JSON.stringify(prev.capture.audioSources ?? [])
  const legacyChanged = c.micDevice !== prev.capture.micDevice || c.systemAudio !== prev.capture.systemAudio

  if (!sources.length || (legacyChanged && !sourcesChanged)) {
    if (!sources.some((x) => x.kind === 'desktop')) sources.unshift({ id: 'desktop', kind: 'desktop', name: 'Game & voice chat', enabled: c.systemAudio, volume: 1, ownTrack: false })
    sources = sources.map((x) => (x.kind === 'desktop' ? { ...x, enabled: c.systemAudio } : x))
    const firstMic = sources.find((x) => x.kind === 'mic')
    if (c.micDevice) {
      if (firstMic) Object.assign(firstMic, { device: c.micDevice, enabled: true })
      else sources.push({ id: 'mic1', kind: 'mic', device: c.micDevice, name: 'Microphone', enabled: true, volume: 1, ownTrack: false, trigger: true })
    } else if (firstMic) {
      firstMic.enabled = false
    }
  }
  const mic = sources.find((x) => x.kind === 'mic' && x.enabled && x.device)
  c.audioSources = sources
  c.micDevice = mic?.device ?? ''
  c.systemAudio = !!sources.find((x) => x.kind === 'desktop')?.enabled
  return { ...next, capture: c }
}
