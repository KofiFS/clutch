import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, net, Notification, protocol, session, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Platform, Settings } from '../shared/types'
import { detectEncoders, listAudioDevices, trimClip } from './capture/ffmpeg'
import { disposeForegroundWatcher, listRunningApps } from './capture/foreground'
import { checkWebhook, makeShareable, postClip } from './share/discord'
import { clipOfTheDay, DailyDigest } from './highlights'
import { healthCheck } from './health'
import type { LibraryQuery } from './library'
import { OverlayToast } from './overlay'
import { Recorder } from './recorder'
import { SettingsStore } from './settings'
import { AppTray, iconPath } from './tray'
import { UploadScheduler, type EnqueueOptions } from './upload/scheduler'

// The app is called Clutch, but its data (settings, clip index, thumbnails) predates the rename and
// stores absolute paths, so keep the original data folder instead of moving it.
app.setName('Clutch')
app.setPath('userData', path.join(app.getPath('appData'), 'clipforge'))
if (process.platform === 'win32') app.setAppUserModelId('com.iceko.clutch')

// Serve local clip files and thumbnails to the renderer through a dedicated scheme.
protocol.registerSchemesAsPrivileged([{ scheme: 'cf', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }])

let win: BrowserWindow | null = null
let settings: SettingsStore
let recorder: Recorder
let scheduler: UploadScheduler
let tray: AppTray | null = null
let overlay: OverlayToast | null = null
let registeredHotkey = ''
const registeredKeys = new Set<string>()
let hotkeySignature = ''
let digest: DailyDigest | null = null
let quitting = false
let currentMaterial: 'acrylic' | 'none' = 'none'

const TITLEBAR = { color: '#00000000', symbolColor: '#b4c3d9', height: 44 }

/** Windows 11 22H2+ (build 22621) supports acrylic window backgrounds. */
const canAcrylic = process.platform === 'win32' && Number(process.getSystemVersion().split('.')[2] ?? 0) >= 22621

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    backgroundColor: settings.get().app.windowGlass && canAcrylic ? '#00000000' : '#03050b',
    backgroundMaterial: settings.get().app.windowGlass && canAcrylic ? 'acrylic' : 'none',
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLEBAR,
    icon: nativeImage.createFromPath(iconPath(256)),
    title: 'Clutch',
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

const hotkeySig = (s: Settings) => JSON.stringify([s.capture.clipHotkey, s.capture.extraHotkeys, s.capture.lengthUpHotkey, s.capture.lengthDownHotkey])

/** Show the new clip length over the game; it is the only feedback you get while playing. */
function announceLength(r: { seconds: number; edge: 'min' | 'max' | null }) {
  const c = settings.get().capture
  const keys = [c.lengthDownHotkey, c.lengthUpHotkey].filter(Boolean).join(' / ')
  const sub = r.edge === 'max' ? `Longest your ${recorder.effectiveCapture().bufferSeconds}s buffer allows` : r.edge === 'min' ? 'Shortest preset' : keys ? `${keys} to change` : ''
  overlay?.show(`Clip length: ${r.seconds}s`, sub, 'info', 1800)
}

/** Registers the main clip hotkey, extra length hotkeys and the in-game length up/down keys. */
function registerHotkey(s: Settings) {
  for (const k of registeredKeys) globalShortcut.unregister(k)
  registeredKeys.clear()
  registeredHotkey = ''
  hotkeySignature = hotkeySig(s)
  const failed: string[] = []
  const reg = (accel: string, fn: () => void): boolean | undefined => {
    const k = accel.trim()
    if (!k) return undefined
    if (registeredKeys.has(k)) { failed.push(`${k} (used twice)`); return false }
    let ok = false
    try { ok = globalShortcut.register(k, fn) } catch { ok = false }
    if (ok) registeredKeys.add(k)
    else failed.push(k)
    return ok
  }
  const mainOk = reg(s.capture.clipHotkey, () => void recorder.clipNow('hotkey'))
  if (mainOk) registeredHotkey = s.capture.clipHotkey.trim()
  for (const x of s.capture.extraHotkeys) reg(x.key, () => void recorder.clipNow('hotkey', x.seconds))
  reg(s.capture.lengthUpHotkey, () => announceLength(recorder.stepClipLength(1)))
  reg(s.capture.lengthDownHotkey, () => announceLength(recorder.stepClipLength(-1)))
  if (failed.length) recorder.log('error', `Could not register ${failed.join(', ')} - another app (Medal?) may already use ${failed.length > 1 ? 'them' : 'it'}. Pick different keys under Settings.`)
  recorder.setHotkeyRegistered(mainOk !== false && !!s.capture.clipHotkey.trim())
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
  settings.onChange((s) => {
    if (hotkeySig(s) !== hotkeySignature) registerHotkey(s)
    tray?.refresh()
    // Keep the window in sync with changes made by the main process (YouTube connect, tray, etc.).
    send('settings-changed', s)
    if (win && canAcrylic) {
      const want = s.app.windowGlass ? 'acrylic' : 'none'
      if (want !== currentMaterial) {
        currentMaterial = want
        win.setBackgroundColor(s.app.windowGlass ? '#00000000' : '#03050b')
        win.setBackgroundMaterial(want)
      }
    }
  })

  /** Make a Discord-sized copy if needed, post it, remember it. */
  const postToDiscord = async (clipId: string, opts: { heading?: string; note?: string } = {}) => {
    const clip = recorder.library.get(clipId)
    if (!clip) throw new Error('Clip not found')
    const d = settings.get().discord
    if (!d.webhookUrl) throw new Error('Add a Discord webhook under Settings → Discord first')
    recorder.log('discord', `Preparing "${clip.title}" for Discord…`, clip.id)
    const { file, transcoded } = await makeShareable(clip, d.maxMb, path.join(dataDir, 'share'))
    await postClip({ webhookUrl: d.webhookUrl, clip, file, heading: opts.heading, mention: d.mention || undefined, note: opts.note })
    recorder.library.markPosted(clip.id)
    recorder.log('discord', `Posted "${clip.title}" to Discord${transcoded ? ' (Discord-sized copy)' : ''}`, clip.id)
    return { transcoded }
  }

  digest = new DailyDigest(recorder.library, () => settings.get().discord.dailyDigest)
  digest.on('digest', ({ clip }) => {
    send('clip-of-the-day', clip)
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'Your clip of the day', body: `${clip.title} · ${clip.game}`, icon: nativeImage.createFromPath(clip.thumbnail) })
      n.on('click', () => { showWindow(); send('open-clip', clip.id) })
      n.show()
    }
    const d = settings.get().discord
    if (d.dailyDigest.enabled && d.webhookUrl) {
      postToDiscord(clip.id, { heading: '**Clip of the day**' }).catch((e) => recorder.log('error', `Clip of the day was not posted: ${e instanceof Error ? e.message : String(e)}`))
    }
  })
  digest.on('empty', () => recorder.log('info', 'No clips today, so no clip of the day'))
  digest.start()

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
    if (!accel) return false
    if (registeredKeys.has(accel)) return true
    try {
      const ok = globalShortcut.register(accel, () => undefined)
      if (ok) globalShortcut.unregister(accel)
      return ok
    } catch { return false }
  })
  ipcMain.handle('system:testOverlay', () => overlay?.show('Clipped!', 'This is how it looks in game', 'clip'))
  ipcMain.handle('system:canAcrylic', () => canAcrylic)
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

  ipcMain.handle('library:viewed', (_e, id: string) => recorder.library.markViewed(id))
  ipcMain.handle('highlights:today', () => clipOfTheDay(recorder.library) ?? null)
  ipcMain.handle('discord:check', (_e, url: string) => checkWebhook(url))
  ipcMain.handle('discord:post', (_e, clipId: string, opts: { heading?: string; note?: string }) => postToDiscord(clipId, opts))
  ipcMain.handle('discord:postToday', async () => {
    const best = clipOfTheDay(recorder.library)
    if (!best) throw new Error('No clips recorded today yet')
    await postToDiscord(best.clip.id, { heading: '**Clip of the day**' })
    return best.clip
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
    lengths: () => ({ options: recorder.lengthOptions(), current: recorder.effectiveCapture().preSeconds }),
    setLength: (n: number) => { recorder.setClipLength(n); announceLength({ seconds: n, edge: null }) },
    quit: () => { quitting = true; app.quit() },
    isRunning: () => recorder.status.running
  })

  currentMaterial = settings.get().app.windowGlass && canAcrylic ? 'acrylic' : 'none'
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
  digest?.stop()
  disposeForegroundWatcher()
  recorder?.dispose()
  await recorder?.stop('manual')
})
