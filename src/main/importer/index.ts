import { app, nativeImage, screen } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ImportedSettings, ImportResult, Settings } from '../../shared/types'
import { listAudioDevices } from '../capture/ffmpeg'
import { mergeFound, parseOcr, propose, type OcrLine } from './parse'

/**
 * "Bring your settings": read another recorder's settings from screenshots (Windows' own text
 * recognition, offline, no account) or straight from OBS's config files.
 */

const POWERSHELL = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const ocrScript = () => path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources', 'ocr.ps1')

/** Small UI text reads far better enlarged, so screenshots are scaled up (to at most ~4000 px). */
function prepare(buf: Buffer): { png: Buffer; scale: number } {
  const img = nativeImage.createFromBuffer(buf)
  if (img.isEmpty()) throw new Error('That file is not a picture Clutch can read. Use a PNG or JPG screenshot.')
  const { width, height } = img.getSize()
  const long = Math.max(width, height)
  const scale = long < 1400 ? 2 : long < 2000 ? 1.5 : 1
  const out = scale === 1 ? img : img.resize({ width: Math.round(width * scale), quality: 'best' })
  return { png: out.toPNG(), scale }
}

function runOcr(file: string): Promise<OcrLine[]> {
  return new Promise((resolve, reject) => {
    execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ocrScript()], {
      windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, CLUTCH_OCR_IMAGE: file }
    }, (err, stdout) => {
      if (err) return reject(new Error('Windows could not read text from that picture.'))
      try {
        const v = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim() || '[]')
        resolve(Array.isArray(v) ? v : [v])
      } catch { reject(new Error('Windows could not read text from that picture.')) }
    })
  })
}

/** Read each screenshot with Windows OCR and merge what was found. */
export async function readScreenshots(images: Buffer[], tmpDir: string): Promise<{ found: ImportedSettings; lines: number }> {
  fs.mkdirSync(tmpDir, { recursive: true })
  const parsed: ImportedSettings[] = []
  let lines = 0
  for (const [i, buf] of images.entries()) {
    const { png } = prepare(buf)
    const file = path.join(tmpDir, `import-${Date.now()}-${i}.png`)
    fs.writeFileSync(file, png)
    try {
      const l = await runOcr(file)
      lines += l.length
      parsed.push(parseOcr(l))
    } finally {
      try { fs.unlinkSync(file) } catch { /* ignore */ }
    }
  }
  return { found: mergeFound(parsed), lines }
}

/** Downscaled JPEGs for the optional smart read (keeps uploads small). */
export function forSmartRead(images: Buffer[]): { media_type: 'image/jpeg'; data: string }[] {
  return images.slice(0, 4).map((b) => {
    let img = nativeImage.createFromBuffer(b)
    const { width, height } = img.getSize()
    if (Math.max(width, height) > 2400) img = img.resize(width >= height ? { width: 2400, quality: 'best' } : { height: 2400, quality: 'best' })
    return { media_type: 'image/jpeg', data: img.toJPEG(88).toString('base64') }
  })
}

// ---------------------------------------------------------------- OBS

function readIni(file: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  let sec = ''
  let text = ''
  try { text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') } catch { return out }
  for (const line of text.split(/\r?\n/)) {
    const s = line.match(/^\[(.+)\]\s*$/)
    if (s) { sec = s[1]; out[sec] ??= {}; continue }
    const kv = line.match(/^([^=]+)=(.*)$/)
    if (kv && sec) out[sec][kv[1].trim()] = kv[2]
  }
  return out
}

const obsDir = () => path.join(app.getPath('appData'), 'obs-studio')

export function hasObs(): boolean {
  return fs.existsSync(path.join(obsDir(), 'basic', 'profiles'))
}

/** OBS hotkey JSON: {"ReplayBuffer.Save":[{"key":"OBS_KEY_F8","alt":true}]} */
function obsHotkey(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const j = JSON.parse(raw) as Record<string, { key?: string; shift?: boolean; control?: boolean; alt?: boolean; command?: boolean }[]>
    const b = j['ReplayBuffer.Save']?.[0]
    const k = b?.key?.replace(/^OBS_KEY_/, '')
    if (!b || !k) return undefined
    const key = /^F\d{1,2}$/.test(k) || /^[A-Z0-9]$/.test(k) ? k : ({ PAGEUP: 'PageUp', PAGEDOWN: 'PageDown', HOME: 'Home', END: 'End', INSERT: 'Insert', DELETE: 'Delete', PRINT: 'PrintScreen', SPACE: 'Space' } as Record<string, string>)[k]
    if (!key) return undefined
    return [b.control && 'Ctrl', b.alt && 'Alt', b.shift && 'Shift', b.command && 'Super', key].filter(Boolean).join('+')
  } catch { return undefined }
}

/** Read the active OBS profile straight from its files. */
export function readObs(): ImportedSettings | null {
  const dir = obsDir()
  const global = readIni(path.join(dir, 'global.ini'))
  // OBS 30+ moved the active profile to user.ini.
  const user = readIni(path.join(dir, 'user.ini'))
  const profileDir = user.Basic?.ProfileDir ?? global.Basic?.ProfileDir
  const profiles = path.join(dir, 'basic', 'profiles')
  let name: string | undefined = profileDir
  if (!name || !fs.existsSync(path.join(profiles, name))) {
    try { name = fs.readdirSync(profiles).find((d) => fs.existsSync(path.join(profiles, d, 'basic.ini'))) } catch { name = undefined }
  }
  if (!name) return null
  const ini = readIni(path.join(profiles, name, 'basic.ini'))
  const v = ini.Video ?? {}
  const o = ini.Output ?? {}
  const adv = o.Mode === 'Advanced'
  const out = adv ? ini.AdvOut ?? {} : ini.SimpleOutput ?? {}
  const found: ImportedSettings = { app: 'OBS', notes: [] }

  const fpsType = v.FPSType ?? '0'
  const fps = fpsType === '1' ? Number(v.FPSInt) : fpsType === '2' ? Number(v.FPSNum) / Math.max(1, Number(v.FPSDen) || 1) : Number(v.FPSCommon ?? 30)
  if (fps > 0) found.fps = Math.round(fps)
  const outH = Number(v.OutputCY)
  if (outH > 0) found.outputHeight = outH
  // Only when the replay buffer is actually on in OBS; otherwise its length is just a default.
  const rb = Number(out.RecRBTime)
  if (rb > 0 && out.RecRB === 'true') found.bufferSeconds = rb
  if (!adv) {
    const q = out.RecQuality
    found.quality = q === 'Lossless' || q === 'HQ' ? 'max' : q === 'Small' ? 'high' : q === 'Stream' ? 'medium' : undefined
  }
  const folder = (adv ? out.RecFilePath : out.FilePath)?.replace(/\\\\/g, '\\')
  if (folder) found.saveFolder = folder
  found.hotkey = obsHotkey(ini.Hotkeys?.ReplayBuffer)
  // Audio devices live in the scene collection, by Windows device ID rather than name.
  const coll = user.Basic?.SceneCollectionFile ?? global.Basic?.SceneCollectionFile
  if (coll) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'basic', 'scenes', `${coll}.json`), 'utf8')) as Record<string, unknown>
      found.systemAudio = !!j.DesktopAudioDevice1
      if (j.AuxAudioDevice1) found.notes.push('OBS stores your mic by Windows device ID, so pick it under Audio sources')
    } catch { /* no collection */ }
  }
  return found
}

// ---------------------------------------------------------------- shared

/**
 * OCR can blur a letter or two in a path ("C:\Users\iceko" read as "C:\Users\lceko"). Walk the
 * path and snap each part to the closest real folder, so a screenshot from this PC just works.
 */
export function fixFolder(p: string): string {
  if (fs.existsSync(p)) return p
  const home = os.homedir()
  const m = p.match(/^[A-Za-z]:\\Users\\[^\\]+(\\.*)?$/i)
  if (m) {
    const guess = path.join(home, m[1] ?? '')
    if (fs.existsSync(guess)) return guess
  }
  const parts = p.split('\\').filter(Boolean)
  if (!/^[A-Za-z]:$/.test(parts[0] ?? '')) return p
  let cur = parts[0] + '\\'
  for (const part of parts.slice(1)) {
    const exact = path.join(cur, part)
    if (fs.existsSync(exact)) { cur = exact; continue }
    let kids: string[] = []
    try { kids = fs.readdirSync(cur, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { return p }
    const best = kids.map((k) => ({ k, d: editDistance(k.toLowerCase(), part.toLowerCase()) })).sort((a, b) => a.d - b.d)[0]
    if (!best || best.d > Math.max(2, Math.floor(part.length / 3))) return p
    cur = path.join(cur, best.k)
  }
  return cur
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

/** Turn what was found into proposed changes against the user's current settings. */
export async function proposeChanges(found: ImportedSettings, s: Settings, via: ImportResult['via'], lines?: number): Promise<ImportResult> {
  if (found.saveFolder) found.saveFolder = fixFolder(found.saveFolder)
  const displays = screen.getAllDisplays()
  const d = displays[Math.min(s.capture.monitorIndex, displays.length - 1)] ?? screen.getPrimaryDisplay()
  const audioDevices = await listAudioDevices().catch(() => [] as string[])
  const changes = propose(found, s.capture, {
    monitorHeight: Math.round(d.size.height * d.scaleFactor),
    audioDevices,
    folderExists: (p) => fs.existsSync(p)
  })
  return { found, changes, via, lines }
}
