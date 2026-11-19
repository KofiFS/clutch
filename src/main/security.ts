import { session, shell, type WebContents } from 'electron'
import fs from 'node:fs'
import type { AudioSource, Settings } from '../shared/types'

/**
 * Small guards shared by the main process. The renderer is our own code, but anything it sends
 * over IPC is treated as untrusted input: a bug or an injected script there must not be able to
 * launch arbitrary programs, read arbitrary files or delete files outside Clutch's clips.
 */

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

/** True for web and mail links only (never file:, ms-*:, search-ms:, custom app schemes...). */
export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 4096) return false
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/** Opens a link in the user's browser, refusing anything that is not a web or mail link. */
export async function openExternalSafe(url: unknown): Promise<boolean> {
  if (!isSafeExternalUrl(url)) return false
  await shell.openExternal(url)
  return true
}

/** The clip fields the UI may change. Everything else (file, thumbnail, source...) is main-process only. */
export function clipPatchFromRenderer(patch: unknown): { title?: string; tags?: string[]; favorite?: boolean; game?: string } {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
  const out: { title?: string; tags?: string[]; favorite?: boolean; game?: string } = {}
  if (typeof p.title === 'string') out.title = p.title.slice(0, 300)
  if (typeof p.game === 'string') out.game = p.game.slice(0, 200)
  if (typeof p.favorite === 'boolean') out.favorite = p.favorite
  if (Array.isArray(p.tags)) out.tags = p.tags.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, 60)).slice(0, 50)
  return out
}

/** Media the cf:// scheme may serve. Settings, tokens and logs in the data folder are never served. */
const SERVABLE = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ts', '.jpg', '.jpeg', '.png', '.webp', '.ico'])
export function isServableMedia(file: string): boolean {
  const dot = file.lastIndexOf('.')
  return dot > 0 && SERVABLE.has(file.slice(dot).toLowerCase())
}

/** Video files Clutch may delete (its own recordings); never documents, executables or settings. */
const DELETABLE = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ts'])
export function isDeletableVideo(file: string): boolean {
  const dot = file.lastIndexOf('.')
  return dot > 0 && DELETABLE.has(file.slice(dot).toLowerCase())
}

/** A program name Clutch may hand to PowerShell or WMI ("discord", "Battle.net"): no quotes, $, (), ; or backticks. */
export function isSafeProcessName(name: unknown): name is string {
  return typeof name === 'string' && /^[\w.\- ]{1,100}$/.test(name.replace(/\.exe$/i, ''))
}

export function isDirectory(p: unknown): p is string {
  if (typeof p !== 'string' || !p) return false
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

/** A Clutch cloud server address: https, or plain http only on this PC (local development). Empty = cloud off. */
export function isAllowedServerUrl(url: unknown): url is string {
  if (url === '') return true
  if (typeof url !== 'string' || url.length > 500) return false
  try {
    const u = new URL(url.trim())
    if (u.username || u.password) return false
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

/**
 * Cleans a settings change sent by the UI before it is saved. Settings feed PowerShell, file
 * opening and the signed-in server, so a renderer bug must not be able to plant a command, an
 * executable to "open" or a server to send the session token to. Folders and the cloud copy have
 * their own validated IPC (folder pickers, libraries:*, ownCloud:*), so those keys are dropped here.
 */
export function settingsPatchFromRenderer(patch: unknown, current: Settings): Partial<Settings> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {}
  const p = { ...(patch as Record<string, unknown>) }
  delete p.libraries
  delete p.ownCloud
  for (const k of ['__proto__', 'constructor', 'prototype']) delete p[k]

  if (p.capture && typeof p.capture === 'object') {
    const c = { ...(p.capture as Record<string, unknown>) }
    // The clips folder comes from the folder picker: only an existing folder is accepted.
    if ('outputDir' in c && c.outputDir !== current.capture.outputDir && !isDirectory(c.outputDir)) delete c.outputDir
    if (Array.isArray(c.audioSources)) {
      c.audioSources = c.audioSources.filter((s) => s && typeof s === 'object').map((s: AudioSource) =>
        s.kind === 'app' && !isSafeProcessName(s.process) ? { ...s, process: undefined, enabled: false } : s)
    }
    p.capture = c
  }
  if (p.cloud && typeof p.cloud === 'object') {
    const cl = { ...(p.cloud as Record<string, unknown>) }
    if ('serverUrl' in cl && !isAllowedServerUrl(cl.serverUrl)) delete cl.serverUrl
    p.cloud = cl
  }
  return p as Partial<Settings>
}

/**
 * Keeps a window on its own pages: no navigating away (a dropped file or injected link would
 * otherwise load in a window that has the Clutch preload), and new windows open in the browser
 * only when they are web links.
 */
export function lockWindow(wc: WebContents, isOwnUrl: (url: string) => boolean, allowPopupsToBrowser = true) {
  wc.on('will-navigate', (e, url) => { if (!isOwnUrl(url)) e.preventDefault() })
  wc.on('will-redirect', (e, url) => { if (!isOwnUrl(url)) e.preventDefault() })
  wc.setWindowOpenHandler(({ url }) => {
    if (allowPopupsToBrowser) void openExternalSafe(url)
    return { action: 'deny' }
  })
  wc.on('will-attach-webview', (e) => e.preventDefault())
}

/**
 * Only the permissions Clutch uses: screen + system audio capture (getDisplayMedia) and the
 * microphone level meter. Everything else (geolocation, notifications from pages, USB, HID,
 * serial, clipboard reads...) is refused.
 */
export function restrictPermissions() {
  const allowed = new Set(['media', 'display-capture', 'fullscreen', 'clipboard-sanitized-write'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
  session.defaultSession.setDevicePermissionHandler(() => false)
}
