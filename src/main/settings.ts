import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, type AudioSource, type Settings } from '../shared/types'

/**
 * Settings fields that are secrets. They are kept out of settings.json (plain text that any program
 * or backup can read) and stored in secrets.bin, encrypted with Windows DPAPI for this user.
 * A value found in settings.json (older Clutch versions write it there) wins and is moved over.
 */
const SECRET_PATHS = [['discord', 'webhookUrl'], ['ai', 'anthropicApiKey'], ['upload', 'youtube', 'clientSecret']] as const

function getAt(o: unknown, p: readonly string[]): unknown {
  return p.reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), o)
}
function setAt(o: Record<string, unknown>, p: readonly string[], value: unknown) {
  let cur: Record<string, unknown> = o
  for (const k of p.slice(0, -1)) {
    if (!isObj(cur[k])) return
    cur = cur[k] as Record<string, unknown>
  }
  cur[p[p.length - 1]] = value
}

/** Tiny JSON settings store. Deep-merges saved values over the defaults so new keys never go missing. */
export class SettingsStore {
  private file: string
  private secretsFile: string
  private data: Settings
  private listeners = new Set<(s: Settings) => void>()

  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json')
    this.secretsFile = path.join(app.getPath('userData'), 'secrets.bin')
    this.data = this.load()
    // Move secrets an older version left in settings.json into the encrypted file.
    if (safeStorage.isEncryptionAvailable() && SECRET_PATHS.some((p) => this.plainFileHas(p))) this.write()
    this.data = syncAudio(this.data, this.data)
    // Renamed from ClipForge: update the untouched default upload description.
    if (this.data.upload.youtube.descriptionTemplate === 'Recorded with ClipForge') this.data.upload.youtube.descriptionTemplate = 'Recorded with Clutch'
    if (!this.data.capture.outputDir) {
      this.data.capture.outputDir = path.join(app.getPath('videos'), 'Clutch')
    }
  }

  private load(): Settings {
    let data: Settings
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      data = deepMerge(structuredClone(DEFAULT_SETTINGS), raw) as Settings
    } catch {
      data = structuredClone(DEFAULT_SETTINGS)
    }
    const secrets = this.readSecrets()
    for (const p of SECRET_PATHS) {
      const stored = secrets[p.join('.')]
      if (!getAt(data, p) && typeof stored === 'string' && stored) setAt(data as unknown as Record<string, unknown>, p, stored)
    }
    return data
  }

  private plainFileHas(p: readonly string[]): boolean {
    try { return !!getAt(JSON.parse(fs.readFileSync(this.file, 'utf8')), p) } catch { return false }
  }

  private readSecrets(): Record<string, unknown> {
    try {
      const raw = fs.readFileSync(this.secretsFile)
      if (!safeStorage.isEncryptionAvailable()) return {}
      return JSON.parse(safeStorage.decryptString(raw)) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  /** settings.json without secrets, plus secrets.bin (only when Windows encryption is available). */
  private write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const plain = structuredClone(this.data) as unknown as Record<string, unknown>
    if (safeStorage.isEncryptionAvailable()) {
      const secrets: Record<string, string> = {}
      for (const p of SECRET_PATHS) {
        const v = getAt(this.data, p)
        if (typeof v === 'string' && v) secrets[p.join('.')] = v
        setAt(plain, p, '')
      }
      if (Object.keys(secrets).length) fs.writeFileSync(this.secretsFile, safeStorage.encryptString(JSON.stringify(secrets)))
      else { try { fs.unlinkSync(this.secretsFile) } catch { /* none saved */ } }
    }
    fs.writeFileSync(this.file, JSON.stringify(plain, null, 2))
  }

  get(): Settings {
    return this.data
  }

  set(patch: Partial<Settings>): Settings {
    const prev = this.data
    const merged = deepMerge(prev, patch) as Settings
    // Values that must be replaced, not merged: a one-of type (area) and a map where removing a key matters (profiles).
    if (patch.capture?.area) merged.capture = { ...merged.capture, area: patch.capture.area }
    if (patch.profiles) merged.profiles = patch.profiles
    this.data = syncAudio(prev, merged)
    this.write()
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
    // JSON from disk or IPC can carry these keys; never let them reach an object's prototype.
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
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
