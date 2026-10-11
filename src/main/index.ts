import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, net, protocol, session, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Platform, Settings } from '../shared/types'
import { detectEncoders, listAudioDevices, trimClip } from './capture/ffmpeg'
import type { LibraryQuery } from './library'
import { Recorder } from './recorder'
import { SettingsStore } from './settings'
import { UploadScheduler } from './upload/scheduler'

// Serve local clip files and thumbnails to the renderer through a dedicated scheme.
protocol.registerSchemesAsPrivileged([{ scheme: 'cf', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }])

let win: BrowserWindow | null = null
let settings: SettingsStore
let recorder: Recorder
let scheduler: UploadScheduler
let registeredHotkey = ''

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    title: 'ClipForge',
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  // Production UI is served from cf://app/ (a registered secure scheme) rather than file:// so that
  // audio worklets, blob URLs and other secure-context features work.
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadURL('cf://app/index.html')
  win.on('closed', () => { win = null })
}

function send(channel: string, payload: unknown) {
  win?.webContents.send(channel, payload)
}

function registerHotkey(s: Settings) {
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey)
  registeredHotkey = ''
  const key = s.capture.clipHotkey.trim()
  if (!key) return
  const ok = globalShortcut.register(key, () => void recorder.clipNow('hotkey'))
  if (ok) registeredHotkey = key
  else recorder.log('error', `Could not register hotkey "${key}" (already in use?)`)
}

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })

app.whenReady().then(async () => {
  const dataDir = app.getPath('userData')
  settings = new SettingsStore()
  recorder = new Recorder(settings, dataDir)
  scheduler = new UploadScheduler(recorder.library, () => settings.get(), dataDir)

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
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }).then((sources) => cb({ video: sources[0], audio: 'loopback' })).catch(() => cb({}))
  })

  recorder.on('status', (st) => send('status', st))
  recorder.on('activity', (ev) => send('activity', ev))
  recorder.library.on('change', () => send('library-changed', null))
  scheduler.on('change', () => send('uploads-changed', null))
  scheduler.on('log', (m) => recorder.log('upload', m))
  settings.onChange((s) => registerHotkey(s))

  // ---- IPC ----
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => settings.set(patch))
  ipcMain.handle('settings:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('system:audioDevices', () => listAudioDevices())
  ipcMain.handle('system:encoders', () => detectEncoders())
  ipcMain.handle('system:openExternal', (_e, url: string) => shell.openExternal(url))

  ipcMain.handle('buffer:start', () => recorder.start())
  ipcMain.handle('buffer:stop', () => recorder.stop())
  ipcMain.handle('buffer:status', () => recorder.status)
  ipcMain.handle('clip:now', () => recorder.clipNow('manual'))
  ipcMain.handle('activity:list', () => recorder.activity)
  ipcMain.on('audio:push', (_e, pcm: ArrayBuffer, levelDb: number) => recorder.pushSystemAudio(Buffer.from(pcm), levelDb))

  ipcMain.handle('library:query', (_e, q: LibraryQuery) => recorder.library.query(q))
  ipcMain.handle('library:games', () => recorder.library.games())
  ipcMain.handle('library:tags', () => recorder.library.tags())
  ipcMain.handle('library:update', (_e, id: string, patch: Record<string, unknown>) => recorder.library.update(id, patch))
  ipcMain.handle('library:remove', (_e, id: string) => recorder.library.remove(id))
  ipcMain.handle('library:reveal', (_e, file: string) => shell.showItemInFolder(file))
  ipcMain.handle('library:openFolder', () => shell.openPath(settings.get().capture.outputDir))
  ipcMain.handle('library:trim', async (_e, id: string, startSec: number, endSec: number) => {
    const clip = recorder.library.get(id)
    if (!clip) return null
    const out = clip.file.replace(/\.mp4$/i, ` trim ${Math.round(startSec)}-${Math.round(endSec)}.mp4`)
    const ok = await trimClip(clip.file, out, startSec, endSec)
    if (!ok) throw new Error('Trim failed')
    return recorder.library.add(out, { game: clip.game, trigger: clip.trigger, event: clip.event, title: `${clip.title} (trimmed)`, tags: clip.tags })
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
  ipcMain.handle('upload:enqueue', (_e, clipId: string, platform: Platform, at?: string) => scheduler.enqueue(clipId, platform, at ? new Date(at) : new Date()))
  ipcMain.handle('upload:cancel', (_e, clipId: string, uploadId: string) => scheduler.cancel(clipId, uploadId))
  ipcMain.handle('upload:list', () => scheduler.list())

  createWindow()
  registerHotkey(settings.get())
  scheduler.start()
  recorder.library.reconcile()
  if (settings.get().startBufferOnLaunch) void recorder.start()
})

app.on('window-all-closed', async () => {
  await recorder?.stop()
  app.quit()
})
app.on('will-quit', () => globalShortcut.unregisterAll())
