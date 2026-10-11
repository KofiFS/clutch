import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, net, protocol, session, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Platform, Settings } from '../shared/types'
import { detectEncoders, listAudioDevices, trimClip } from './capture/ffmpeg'
import { listRunningApps } from './capture/foreground'
import { healthCheck } from './health'
import type { LibraryQuery } from './library'
import { OverlayToast } from './overlay'
import { Recorder } from './recorder'
import { SettingsStore } from './settings'
import { AppTray, iconPath } from './tray'
import { UploadScheduler, type EnqueueOptions } from './upload/scheduler'

// Serve local clip files and thumbnails to the renderer through a dedicated scheme.
protocol.registerSchemesAsPrivileged([{ scheme: 'cf', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }])

let win: BrowserWindow | null = null
let settings: SettingsStore
let recorder: Recorder
let scheduler: UploadScheduler
let tray: AppTray | null = null
let overlay: OverlayToast | null = null
let registeredHotkey = ''
let quitting = false

const TITLEBAR = { color: '#0d0f15', symbolColor: '#aab2c5', height: 40 }

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    backgroundColor: '#07080c',
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLEBAR,
    icon: nativeImage.createFromPath(iconPath(256)),
    title: 'ClipForge',
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  win.once('ready-to-show', () => { if (!settings.get().app.startMinimized) win?.show() })
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  // Production UI is served from cf://app/ (a registered secure scheme) rather than file:// so that
  // audio worklets, blob URLs and other secure-context features work.
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadURL('cf://app/index.html')
  win.on('close', (e) => {
    if (!quitting && settings.get().app.minimizeToTray && tray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => { win = null })
}

function showWindow() {
  if (!win) createWindow()
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
}

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function registerHotkey(s: Settings) {
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey)
  registeredHotkey = ''
  const key = s.capture.clipHotkey.trim()
  if (!key) { recorder.setHotkeyRegistered(false); return }
  let ok = false
  try { ok = globalShortcut.register(key, () => void recorder.clipNow('hotkey')) } catch { ok = false }
  if (ok) registeredHotkey = key
  else recorder.log('error', `Could not register hotkey "${key}" - another app (Medal?) already uses it. Pick a different key under Settings.`)
  recorder.setHotkeyRegistered(ok)
}

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => showWindow())

app.whenReady().then(async () => {
  const dataDir = app.getPath('userData')
  settings = new SettingsStore()
  recorder = new Recorder(settings, dataDir)
  scheduler = new UploadScheduler(recorder.library, () => settings.get(), dataDir)
  overlay = new OverlayToast()

  // cf://file/<absolute path> -> local file (thumbnails, clip playback)
  // cf://app/<relative>       -> built renderer files
  const rendererDir = path.join(__dirname, '../renderer')
  protocol.handle('cf', (req) => {
    const u = new URL(req.url)
    const rel = decodeURIComponent(u.pathname.replace(/^\//, ''))
    if (u.host === 'app') {
      const target = path.normalize(path.join(rendererDir, rel || 'index.html'))
      if (!target.startsWith(rendererDir)) return new Response('forbidden', { status: 403 })
      return net.fetch(pathToFileURL(target).toString())
    }
    return net.fetch(pathToFileURL(rel).toString())
  })

  // System audio: the renderer calls getDisplayMedia({audio:true}) and we hand it the screen + loopback audio.
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
      .then((sources) => cb({ video: sources[0], audio: 'loopback' }))
      .catch(() => cb({}))
  })

  recorder.on('status', (st) => { send('status', st); tray?.refresh({ running: st.running, game: st.game }) })
  recorder.on('activity', (ev) => send('activity', ev))
  recorder.on('clip', (clip) => {
    send('clip-saved', clip)
    if (settings.get().app.overlayToasts) overlay?.show('Clipped!', `${clip.game} · ${Math.round(clip.durationSec)}s`, 'clip')
  })
  recorder.on('game', (g) => send('game', g))
  recorder.library.on('change', () => send('library-changed', null))
  scheduler.on('change', () => send('uploads-changed', null))
  scheduler.on('log', (m) => recorder.log('upload', m))
  scheduler.on('done', ({ clip, upload }) => send('upload-done', { clipId: clip.id, url: upload.url, title: clip.title }))
  settings.onChange((s) => { if (s.capture.clipHotkey !== registeredHotkey) registerHotkey(s) })

  // ---- IPC ----
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => settings.set(patch))
  ipcMain.handle('settings:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('system:audioDevices', () => listAudioDevices())
  ipcMain.handle('system:encoders', () => detectEncoders())
  ipcMain.handle('system:runningApps', () => listRunningApps())
  ipcMain.handle('system:openExternal', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('system:health', () => healthCheck(settings.get(), recorder.status))
  ipcMain.handle('system:testHotkey', (_e, accel: string) => {
    // Try registering without stealing the user's current hotkey.
    if (!accel || accel === registeredHotkey) return accel === registeredHotkey && !!registeredHotkey
    try {
      const ok = globalShortcut.register(accel, () => undefined)
      if (ok) globalShortcut.unregister(accel)
      return ok
    } catch { return false }
  })
  ipcMain.handle('system:testOverlay', () => overlay?.show('Clipped!', 'This is how it looks in game', 'clip'))
  ipcMain.handle('window:minimize', () => win?.minimize())
  ipcMain.handle('window:hide', () => win?.hide())

  ipcMain.handle('buffer:start', () => recorder.start('manual'))
  ipcMain.handle('buffer:stop', () => recorder.stop('manual'))
  ipcMain.handle('buffer:status', () => recorder.status)
  ipcMain.handle('clip:now', () => recorder.clipNow('manual'))
  ipcMain.handle('activity:list', () => recorder.activity)
  ipcMain.on('audio:push', (_e, pcm: ArrayBuffer, levelDb: number) => recorder.pushSystemAudio(Buffer.from(pcm), levelDb))

  ipcMain.handle('library:query', (_e, q: LibraryQuery) => recorder.library.query(q))
  ipcMain.handle('library:get', (_e, id: string) => recorder.library.get(id))
  ipcMain.handle('library:games', () => recorder.library.games())
  ipcMain.handle('library:tags', () => recorder.library.tags())
  ipcMain.handle('library:stats', () => recorder.library.stats())
  ipcMain.handle('library:update', (_e, id: string, patch: Record<string, unknown>) => recorder.library.update(id, patch))
  ipcMain.handle('library:bulk', (_e, ids: string[], patch: { favorite?: boolean; addTags?: string[] }) => recorder.library.bulk(ids, patch))
  ipcMain.handle('library:trash', (_e, ids: string[]) => {
    const useTrash = settings.get().app.useTrash
    for (const id of ids) useTrash ? recorder.library.trash(id) : recorder.library.remove(id)
    return useTrash
  })
  ipcMain.handle('library:restore', (_e, ids: string[]) => { for (const id of ids) recorder.library.restore(id) })
  ipcMain.handle('library:remove', (_e, ids: string[]) => { for (const id of ids) recorder.library.remove(id) })
  ipcMain.handle('library:emptyTrash', () => recorder.library.emptyTrash())
  ipcMain.handle('library:reveal', (_e, file: string) => shell.showItemInFolder(file))
  ipcMain.handle('library:openFolder', () => shell.openPath(settings.get().capture.outputDir))
  ipcMain.handle('library:trim', async (_e, id: string, startSec: number, endSec: number, mode: 'new' | 'replace') => {
    const clip = recorder.library.get(id)
    if (!clip) return null
    const out = clip.file.replace(/\.mp4$/i, ` trim ${Math.round(startSec)}-${Math.round(endSec)}.mp4`)
    const ok = await trimClip(clip.file, out, startSec, endSec)
    if (!ok) throw new Error('Trim failed')
    if (mode === 'replace') {
      const added = await recorder.library.add(out, { game: clip.game, gameProcess: clip.gameProcess, gameIcon: clip.gameIcon, trigger: clip.trigger, event: clip.event, title: clip.title, tags: clip.tags })
      recorder.library.update(added.id, { favorite: clip.favorite })
      recorder.library.remove(clip.id)
      return added
    }
    return recorder.library.add(out, { game: clip.game, gameProcess: clip.gameProcess, gameIcon: clip.gameIcon, trigger: clip.trigger, event: clip.event, title: `${clip.title} (trimmed)`, tags: clip.tags })
  })

  ipcMain.handle('youtube:connect', async () => {
    const r = await scheduler.youtube().connect()
    settings.set({ upload: { ...settings.get().upload, youtube: { ...settings.get().upload.youtube, connected: true, channelTitle: r.channelTitle } } })
    return r
  })
  ipcMain.handle('youtube:disconnect', () => {
    scheduler.youtube().disconnect()
    settings.set({ upload: { ...settings.get().upload, youtube: { ...settings.get().upload.youtube, connected: false, channelTitle: undefined } } })
  })
  ipcMain.handle('upload:enqueue', (_e, clipId: string, platform: Platform, opts: (Omit<EnqueueOptions, 'scheduledAt'> & { scheduledAt?: string }) = {}) =>
    scheduler.enqueue(clipId, platform, { ...opts, scheduledAt: opts.scheduledAt ? new Date(opts.scheduledAt) : undefined }))
  ipcMain.handle('upload:cancel', (_e, clipId: string, uploadId: string) => scheduler.cancel(clipId, uploadId))
  ipcMain.handle('upload:list', () => scheduler.list())
  ipcMain.handle('upload:next', (_e, platform: Platform) => scheduler.nextScheduled(platform))
  ipcMain.handle('upload:preview', (_e, clipId: string) => {
    const clip = recorder.library.get(clipId)
    const y = settings.get().upload.youtube
    return clip ? { title: scheduler.fill(y.titleTemplate, clip), description: scheduler.fill(y.descriptionTemplate, clip), tags: y.tags, privacy: y.privacy } : null
  })

  tray = new AppTray({
    show: showWindow,
    startStop: () => void (recorder.status.running ? recorder.stop('manual') : recorder.start('manual')),
    clipNow: () => void recorder.clipNow('manual'),
    quit: () => { quitting = true; app.quit() },
    isRunning: () => recorder.status.running
  })

  createWindow()
  registerHotkey(settings.get())
  scheduler.start()
  recorder.library.reconcile()
  if (settings.get().startBufferOnLaunch) void recorder.start('manual')
})

app.on('activate', () => showWindow())
app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => {
  // Keep running in the tray unless the user quit explicitly.
  if (quitting || !settings?.get().app.minimizeToTray) app.quit()
})
app.on('will-quit', async () => {
  globalShortcut.unregisterAll()
  overlay?.destroy()
  recorder?.dispose()
  await recorder?.stop('manual')
})
