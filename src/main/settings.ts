import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'

/** Tiny JSON settings store. Deep-merges saved values over the defaults so new keys never go missing. */
export class SettingsStore {
  private file: string
  private data: Settings
  private listeners = new Set<(s: Settings) => void>()

  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json')
    this.data = this.load()
    if (!this.data.capture.outputDir) {
      this.data.capture.outputDir = path.join(app.getPath('videos'), 'ClipForge')
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
    this.data = deepMerge(this.data, patch) as Settings
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
