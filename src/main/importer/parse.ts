import type { AudioSource, CaptureSettings, ImportChange, ImportedSettings } from '../../shared/types'

/**
 * Turns text read off a screenshot of another recorder's settings (Medal, OBS, NVIDIA App, Xbox Game
 * Bar, SteelSeries Moments...) into settings, without AI. Settings screens are label/value pairs, so
 * each known label is matched with the value on the same row to its right, or just below it.
 *
 * Pure functions only (no Electron), so they can be tested with plain Node.
 */

export interface OcrLine {
  text: string
  x: number
  y: number
  w: number
  h: number
}

type Field = 'fps' | 'resolution' | 'clip' | 'buffer' | 'quality' | 'bitrate' | 'hotkey' | 'folder' | 'mic' | 'systemAudio'

/** Label patterns, most specific first. A label line must look like a label (short, no value inside). */
const LABELS: { field: Field; re: RegExp; not?: RegExp }[] = [
  { field: 'buffer', re: /\b(instant replay length|replay length|maximum replay time|max(imum)? replay|replay buffer( length| time| duration)?|buffer (length|size|duration)|record the last|keep the last)\b/i },
  { field: 'clip', re: /\b(clip (length|duration|time)|length of clips?|clip the last|save the last|default clip)\b/i },
  { field: 'fps', re: /\b(frame ?rate|framerate|fps( values)?|frames per second|common fps)\b/i },
  { field: 'resolution', re: /\b(output \(scaled\)|output resolution|video resolution|recording resolution|capture resolution|resolution)\b/i, not: /\b(base|canvas)\b/i },
  { field: 'bitrate', re: /\b(video )?bit ?rate\b/i, not: /\baudio\b/i },
  { field: 'quality', re: /\b(video quality|recording quality|quality preset|quality)\b/i, not: /\baudio\b/i },
  { field: 'hotkey', re: /\b(clip hotkey|clip key|save clip|save replay|save instant replay|save highlight|clip shortcut|hotkey|key ?bind|keyboard shortcut|shortcut)\b/i, not: /\b(bookmark|screenshot|start|stop|toggle|mute|push)\b/i },
  { field: 'folder', re: /\b(clips? folder|recordings? path|recording path|save (location|to|folder|path)|output folder|storage location|video folder|folder|location|directory|path)\b/i },
  { field: 'mic', re: /\b(microphone|mic\/auxiliary audio|mic\/aux|mic device|input device|mic)\b/i, not: /\b(volume|boost|level|monitor|push|noise)\b/i },
  { field: 'systemAudio', re: /\b(game audio|desktop audio|system audio|record (game |system )?audio|capture (game |system )?audio|record sound)\b/i }
]

const APPS: [RegExp, string][] = [
  [/\bmedal\b/i, 'Medal'],
  [/\bobs\b|\breplay buffer\b|output \(scaled\)/i, 'OBS'],
  [/\b(nvidia|geforce|shadowplay|instant replay)\b/i, 'NVIDIA App'],
  [/\bsteelseries|\bmoments\b/i, 'SteelSeries Moments'],
  [/\boutplayed|overwolf\b/i, 'Outplayed'],
  [/\b(xbox|game bar)\b/i, 'Xbox Game Bar'],
  [/\b(adrenalin|radeon|relive)\b/i, 'AMD Adrenalin']
]

const centerY = (l: OcrLine) => l.y + l.h / 2
const isLabelLike = (l: OcrLine) => l.text.length <= 48 && !/[:\\]\s*\S/.test(l.text.replace(/^[^:]*:\s*$/, ''))

/** The value for a label: text on the same row to its right, otherwise the line right below. */
function valueFor(label: OcrLine, lines: OcrLine[], labelLines: Set<OcrLine>): string {
  // "Clip length: 30 seconds" in one line
  const inline = label.text.split(/[:：]/)
  if (inline.length > 1 && inline.slice(1).join(':').trim()) return inline.slice(1).join(':').trim()
  const tol = Math.max(10, label.h * 1.25)
  const row = lines
    .filter((l) => l !== label && !labelLines.has(l) && l.x > label.x + label.w - 4 && Math.abs(centerY(l) - centerY(label)) < tol)
    .sort((a, b) => a.x - b.x)
  if (row.length) return row.map((l) => l.text).join(' ')
  const below = lines
    .filter((l) => l !== label && !labelLines.has(l) && l.y > label.y + label.h * 0.6 && l.y - (label.y + label.h) < Math.max(28, label.h * 3) && Math.abs(l.x - label.x) < 220)
    .sort((a, b) => a.y - b.y)
  return below[0]?.text ?? ''
}

/** "30 seconds", "1 min", "5 minutes", "1:30", "20 s", "2m 30s" -> seconds */
export function parseDuration(s: string, unitHint?: 'seconds' | 'minutes'): number | undefined {
  const t = s.toLowerCase().replace(/,/g, '.')
  const mmss = t.match(/\b(\d{1,2}):(\d{2})\b/)
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2])
  let total = 0
  let any = false
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)\b/g)) {
    const n = Number(m[1])
    const u = m[2]
    total += u.startsWith('h') ? n * 3600 : u.startsWith('m') ? n * 60 : n
    any = true
  }
  if (any) return Math.round(total)
  const bare = t.match(/\b(\d{1,4})\b/)
  if (bare) return Number(bare[1]) * (unitHint === 'minutes' ? 60 : 1)
  return undefined
}

/** OCR often reads F10 as "FIO" or "F1O", and "+" goes missing. */
const KEY_NAMES: Record<string, string> = {
  ctrl: 'Ctrl', control: 'Ctrl', strg: 'Ctrl', alt: 'Alt', shift: 'Shift', win: 'Super', windows: 'Super', cmd: 'Super', super: 'Super',
  space: 'Space', tab: 'Tab', enter: 'Enter', return: 'Enter', insert: 'Insert', ins: 'Insert', delete: 'Delete', del: 'Delete', home: 'Home', end: 'End',
  pageup: 'PageUp', pgup: 'PageUp', pagedown: 'PageDown', pgdn: 'PageDown', printscreen: 'PrintScreen', prtsc: 'PrintScreen', prtscn: 'PrintScreen', 'print screen': 'PrintScreen',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right'
}
export function parseHotkey(s: string): string | undefined {
  const cleaned = s.replace(/print\s+screen/i, 'printscreen').replace(/page\s+(up|down)/i, 'page$1')
  const tokens = cleaned.split(/[\s+]+/).map((x) => x.replace(/[^\w|]/g, '')).filter(Boolean)
  const mods: string[] = []
  let key: string | undefined
  for (const raw of tokens) {
    const low = raw.toLowerCase()
    const fk = raw.match(/^[Ff]([0-9IlOo|]{1,2})$/)
    if (fk) {
      const n = Number(fk[1].replace(/[Il|]/g, '1').replace(/[Oo]/g, '0'))
      if (n >= 1 && n <= 24) { key = `F${n}`; continue }
    }
    const named = KEY_NAMES[low]
    if (named && ['Ctrl', 'Alt', 'Shift', 'Super'].includes(named)) { if (!mods.includes(named)) mods.push(named); continue }
    if (named) { key = named; continue }
    if (/^[a-z0-9]$/i.test(raw)) { key = raw.toUpperCase(); continue }
    if (/^num(pad)?\s*\d$/i.test(raw)) { key = `num${raw.slice(-1)}`; continue }
  }
  if (!key) return undefined
  // Letters and digits alone would fire while typing in chat.
  if (/^[A-Z0-9]$/.test(key) && !mods.length) return undefined
  const order = ['Ctrl', 'Alt', 'Shift', 'Super']
  return [...mods.sort((a, b) => order.indexOf(a) - order.indexOf(b)), key].join('+')
}

function parseOnOff(s: string): boolean | undefined {
  if (/\b(off|disabled?|none|no|muted)\b/i.test(s)) return false
  if (/\b(on|enabled?|yes|default|all|game|desktop|speakers|headphones|headset|output)\b/i.test(s)) return true
  return undefined
}

function parseQuality(s: string): ImportedSettings['quality'] {
  const t = s.toLowerCase()
  if (/lossless|indistinguishable|very high|ultra|original|best|maximum|\bmax\b|source/.test(t)) return 'max'
  if (/\bhigh\b/.test(t)) return 'high'
  if (/medium|balanced|standard|normal|same as stream|recommended/.test(t)) return 'medium'
  if (/\blow\b|small|performance/.test(t)) return 'low'
  return undefined
}

/** Read every known field from the OCR lines of one or more screenshots. */
export function parseOcr(lines: OcrLine[]): ImportedSettings {
  const all = lines.map((l) => l.text).join('\n')
  const app = APPS.find(([re]) => re.test(all))?.[1] ?? 'another recorder'
  const found: ImportedSettings = { app, notes: [] }

  const labelOf = new Map<OcrLine, Field>()
  for (const l of lines) {
    // "60 FPS", "1080p", "30 seconds" are values even though they contain a label word.
    if (/^\s*[\d.,]+\s*[a-z%]{0,8}\s*$/i.test(l.text)) continue
    if (!isLabelLike(l) && !/[:：]/.test(l.text)) continue
    const head = l.text.split(/[:：]/)[0]
    const hit = LABELS.find((x) => x.re.test(head) && !(x.not && x.not.test(head)))
    if (!hit) continue
    // A label is mostly the label words. "Microphone (Blue Snowball)" is a value that mentions one.
    const rest = head.replace(hit.re, '').replace(/\b(record|enable|enabled|default|the|your|audio|video|settings?|recording|clips?|save)\b/gi, '').replace(/[^a-z0-9]+/gi, '')
    if (rest.length <= 12 || /[:：]/.test(l.text)) labelOf.set(l, hit.field)
  }
  const labelLines = new Set(labelOf.keys())

  for (const [label, field] of labelOf) {
    const v = valueFor(label, lines, labelLines)
    if (!v) continue
    const unitHint = /\(min|minutes\)/i.test(label.text) ? 'minutes' : /\(s|sec|seconds\)/i.test(label.text) ? 'seconds' : undefined
    switch (field) {
      case 'fps': {
        const n = Number(v.match(/\b(\d{2,3})(?:[.,]\d+)?\b/)?.[1])
        if (n >= 20 && n <= 360) found.fps ??= n
        break
      }
      case 'resolution': {
        const p = v.match(/\b(\d{3,4})\s*p\b/i)
        const wh = v.match(/\b(\d{3,4})\s*[x×X*]\s*(\d{3,4})\b/)
        if (p) found.outputHeight ??= Number(p[1])
        else if (wh) found.outputHeight ??= Number(wh[2])
        else if (/\b4k\b/i.test(v)) found.outputHeight ??= 2160
        else if (/\b2k\b/i.test(v)) found.outputHeight ??= 1440
        else if (/native|in-?game|source|original|monitor|display|full/i.test(v)) found.outputHeight ??= 'native'
        break
      }
      case 'clip':
      case 'buffer': {
        // NVIDIA: "Save the last 3 minutes recorded  Alt+F10" is the save shortcut, not a length.
        const key = /\b(f\d{1,2}|alt|ctrl|shift)\b/i.test(v) ? parseHotkey(v) : undefined
        if (key) { found.hotkey ??= key; break }
        const sec = parseDuration(v, unitHint)
        if (sec && sec >= 5 && sec <= 4 * 3600) {
          if (field === 'clip') found.clipSeconds ??= sec
          else found.bufferSeconds ??= sec
        }
        break
      }
      case 'quality': found.quality ??= parseQuality(v); break
      case 'bitrate': {
        const m = v.match(/(\d+(?:[.,]\d+)?)\s*(mbps|mb\/s|mbit|kbps|kb\/s|kbit)?/i)
        if (m) {
          const n = Number(m[1].replace(',', '.'))
          const kb = /k/i.test(m[2] ?? '') || (!m[2] && n > 500)
          const mbps = kb ? n / 1000 : n
          if (mbps > 0.5 && mbps < 500) found.bitrateMbps ??= Math.round(mbps * 10) / 10
        }
        break
      }
      case 'hotkey': found.hotkey ??= parseHotkey(v); break
      case 'folder': {
        const m = v.match(/[A-Za-z]:[\\/][^<>"|?*\n]*/)
        if (m) found.saveFolder ??= m[0].replace(/\//g, '\\').replace(/[\s\\]+$/, '')
        break
      }
      case 'mic': {
        if (parseOnOff(v) === false && v.length < 10) { found.mic ??= null; break }
        const name = v.replace(/\s*\(default\)\s*$/i, '').trim()
        if (name.length >= 3 && !/^(on|off|default)$/i.test(name)) found.mic ??= name
        break
      }
      case 'systemAudio': found.systemAudio ??= parseOnOff(v); break
    }
  }

  // Values that are clear without a label ("60 FPS" next to an icon).
  if (found.fps === undefined) {
    const m = all.match(/\b(30|60|120|144|165|240)\s*fps\b/i)
    if (m) found.fps = Number(m[1])
  }
  if (found.bitrateMbps === undefined) {
    const m = all.match(/\b(\d+(?:[.,]\d+)?)\s*(mbps|mb\/s)\b/i)
    if (m) found.bitrateMbps = Number(m[1].replace(',', '.'))
  }
  // NVIDIA App / Game Bar save the whole replay, so the clip is as long as the buffer.
  if (found.clipSeconds === undefined && found.bufferSeconds !== undefined && /NVIDIA|Game Bar|AMD/.test(app)) found.clipSeconds = found.bufferSeconds
  return found
}

/** Combine reads of several screenshots: the first value found for each field wins. */
export function mergeFound(list: ImportedSettings[]): ImportedSettings {
  const out: ImportedSettings = { app: list.find((f) => f.app !== 'another recorder')?.app ?? 'another recorder', notes: [] }
  for (const f of list) {
    for (const k of ['fps', 'outputHeight', 'quality', 'bitrateMbps', 'bufferSeconds', 'clipSeconds', 'hotkey', 'saveFolder', 'mic', 'systemAudio'] as const) {
      if (out[k] === undefined && f[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = f[k]
    }
    out.notes.push(...f.notes.filter((n) => !out.notes.includes(n)))
  }
  return out
}

const FPS = [30, 60, 120, 144] as const
const nearest = <T extends number>(list: readonly T[], n: number) => list.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a))
const fmtSec = (s: number) => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : s > 60 ? `${Math.floor(s / 60)} min ${s % 60}s` : `${s}s`)
const qualityName = (q: number) => (q <= 19 ? 'max' : q <= 23 ? 'high' : q <= 27 ? 'balanced' : 'small')

/** Normalized device-name similarity, so "Microphone (Blue Snowball)" finds "Microphone (2- Blue Snowball)". */
function deviceScore(a: string, b: string) {
  const norm = (s: string) => s.toLowerCase().replace(/\b(microphone|mic|input|device|default|\d+-)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
  const ta = new Set(norm(a).split(' ').filter(Boolean))
  const tb = new Set(norm(b).split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let common = 0
  for (const t of ta) if (tb.has(t)) common++
  return common / Math.min(ta.size, tb.size)
}

export interface ProposeContext {
  /** Height of the monitor being recorded, physical pixels. */
  monitorHeight: number
  audioDevices: string[]
  folderExists: (p: string) => boolean
}

/** What would change in Clutch, one row per setting, each with the patch that applies it. */
export function propose(found: ImportedSettings, c: CaptureSettings, ctx: ProposeContext): ImportChange[] {
  const out: ImportChange[] = []
  const push = (x: Omit<ImportChange, 'on'> & { on?: boolean }) => out.push({ on: true, ...x })

  if (found.fps) {
    const fps = nearest(FPS, found.fps)
    if (fps !== c.fps) push({ id: 'fps', label: 'Frame rate', from: `${c.fps} fps`, to: `${fps} fps`, patch: { fps }, warn: fps !== found.fps ? `${found.fps} fps isn't offered, so the closest is used` : undefined })
  }

  if (found.outputHeight !== undefined) {
    const ratio = found.outputHeight === 'native' ? 1 : found.outputHeight / Math.max(1, ctx.monitorHeight)
    const scale = ratio >= 0.88 ? 1 : ratio >= 0.62 ? 0.75 : 0.5
    if (scale !== c.resolutionScale) {
      const label = (s: number) => (s === 1 ? 'Native' : `${Math.round(ctx.monitorHeight * s)}p (${s * 100}%)`)
      push({ id: 'res', label: 'Resolution', from: label(c.resolutionScale), to: label(scale), patch: { resolutionScale: scale as CaptureSettings['resolutionScale'] } })
    }
  }

  const q = found.quality ?? (found.bitrateMbps ? (found.bitrateMbps >= 40 ? 'max' : found.bitrateMbps >= 20 ? 'high' : found.bitrateMbps >= 10 ? 'medium' : 'low') : undefined)
  if (q) {
    const quality = { max: 18, high: 21, medium: 24, low: 28 }[q]
    if (qualityName(quality) !== qualityName(c.quality)) {
      push({ id: 'quality', label: 'Quality', from: `${qualityName(c.quality)} (${c.quality})`, to: `${qualityName(quality)} (${quality})`, patch: { quality }, warn: !found.quality && found.bitrateMbps ? `Based on ${found.bitrateMbps} Mbps. Clutch uses constant quality instead of a fixed bitrate` : undefined })
    }
  }

  // Clip length: other apps give the whole clip; Clutch splits it into "back" + "after".
  let pre = c.preSeconds
  if (found.clipSeconds) {
    pre = Math.max(5, Math.min(300, found.clipSeconds - c.postSeconds))
    if (pre !== c.preSeconds) push({ id: 'clip', label: 'Clip length', from: fmtSec(c.preSeconds + c.postSeconds), to: fmtSec(pre + c.postSeconds), patch: { preSeconds: pre } })
  }
  const wantBuffer = found.bufferSeconds ?? (found.clipSeconds && pre > c.bufferSeconds ? pre : undefined)
  if (wantBuffer) {
    const buf = Math.max(30, Math.min(600, Math.ceil(Math.max(wantBuffer, pre) / 30) * 30))
    if (buf !== c.bufferSeconds) push({ id: 'buffer', label: 'Replay length', from: fmtSec(c.bufferSeconds), to: fmtSec(buf), patch: { bufferSeconds: buf }, warn: wantBuffer > 600 ? `${fmtSec(wantBuffer)} is longer than the 10 min replay. Use Long recording for full sessions` : undefined })
  }

  if (found.hotkey && found.hotkey !== c.clipHotkey) push({ id: 'hotkey', label: 'Clip hotkey', from: c.clipHotkey || 'None', to: found.hotkey, warn: found.app === 'Medal' || found.app === 'NVIDIA App' ? `Close ${found.app} first, or both will grab ${found.hotkey}` : undefined, patch: { clipHotkey: found.hotkey } })

  if (found.saveFolder && found.saveFolder.toLowerCase() !== c.outputDir.toLowerCase()) {
    const exists = ctx.folderExists(found.saveFolder)
    push({ id: 'folder', label: 'Save clips to', from: c.outputDir, to: found.saveFolder, patch: { outputDir: found.saveFolder }, on: false, warn: exists ? `Tick to save Clutch clips next to your ${found.app} clips` : 'This folder is not on this PC. Clutch would create it' })
  }

  const sources = c.audioSources ?? []
  if (found.mic) {
    const best = ctx.audioDevices.map((d) => ({ d, s: deviceScore(found.mic!, d) })).sort((a, b) => b.s - a.s)[0]
    const mic = sources.find((s) => s.kind === 'mic')
    if (best && best.s >= 0.5) {
      if (!mic || mic.device !== best.d || !mic.enabled) {
        const next: AudioSource[] = mic
          ? sources.map((s) => (s === mic ? { ...s, device: best.d, name: s.name || 'Microphone', enabled: true } : s))
          : [...sources, { id: `mic-${Date.now().toString(36)}`, kind: 'mic', device: best.d, name: 'Microphone', enabled: true, volume: 1, ownTrack: false, trigger: true }]
        push({ id: 'mic', label: 'Microphone', from: mic?.enabled ? mic.device ?? 'None' : 'Off', to: best.d, patch: { audioSources: next } })
      }
    } else {
      found.notes.push(`Your ${found.app} mic "${found.mic}" isn't plugged in here, so the mic was left as is`)
    }
  } else if (found.mic === null) {
    const mic = sources.find((s) => s.kind === 'mic' && s.enabled)
    if (mic) push({ id: 'mic', label: 'Microphone', from: mic.device ?? mic.name, to: 'Off', on: false, patch: { audioSources: sources.map((s) => (s === mic ? { ...s, enabled: false } : s)) } })
  }

  if (found.systemAudio !== undefined) {
    const desk = sources.find((s) => s.kind === 'desktop')
    const now = !!desk?.enabled
    if (desk && now !== found.systemAudio) {
      const base = (out.find((x) => x.id === 'mic')?.patch.audioSources as AudioSource[] | undefined) ?? sources
      // Both changes edit the same list; this one builds on the mic change so either order works.
      const next = base.map((s) => (s.kind === 'desktop' ? { ...s, enabled: found.systemAudio! } : s))
      push({ id: 'system', label: 'Game & voice chat audio', from: now ? 'On' : 'Off', to: found.systemAudio ? 'On' : 'Off', patch: { audioSources: next } })
    }
  }
  return out
}

/** Apply the chosen rows. Audio rows each carry the full list, so the last chosen one wins. */
export function applyChanges(c: CaptureSettings, changes: ImportChange[]): CaptureSettings {
  let next = { ...c }
  const chosen = changes.filter((x) => x.on)
  const mic = chosen.find((x) => x.id === 'mic')
  const sys = chosen.find((x) => x.id === 'system')
  for (const ch of chosen) if (ch.id !== 'mic' && ch.id !== 'system') next = { ...next, ...ch.patch }
  if (sys && mic) next.audioSources = sys.patch.audioSources!
  else if (mic) next.audioSources = mic.patch.audioSources!
  else if (sys) {
    const want = (sys.patch.audioSources as AudioSource[]).find((s) => s.kind === 'desktop')!.enabled
    next.audioSources = (c.audioSources ?? []).map((s) => (s.kind === 'desktop' ? { ...s, enabled: want } : s))
  }
  if (next.preSeconds > next.bufferSeconds) next.preSeconds = next.bufferSeconds
  return next
}
