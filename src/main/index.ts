import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, net, Notification, protocol, screen, session, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Platform, Settings } from '../shared/types'
import { detectEncoders, listAudioDevices, trimClip } from './capture/ffmpeg'
import { disposeForegroundWatcher, listRunningApps } from './capture/foreground'
import { pickRegion } from './capture/regionPicker'
import { CloudAccount } from './cloud/account'
import { checkWebhook, makeShareable, postClip } from './share/discord'
import { clipOfTheDay, DailyDigest } from './highlights'
import { healthCheck } from './health'
import { isInside, serveFile } from './fileServer'
import type { LibraryQuery } from './library'
import { forSmartRead, hasObs, proposeChanges, readObs, readScreenshots } from './importer'
import { applyChanges } from './importer/parse'
import { fromModel, smartReadLocal } from './importer/smart'
import { MiniWidget } from './miniWidget'
import { Updater } from './updater'
import { detectMedal, LibrarySources } from './library/sources'
import { baseName, outputDirFor } from './library'
import { Compressor } from './library/compressor'
import { OverlayToast } from './overlay'
import { Recorder } from './recorder'
import { SettingsStore } from './settings'
import { AppTray, iconPath } from './tray'
import { UploadScheduler, type EnqueueOptions } from './upload/scheduler'

// The app is called Clutch, but its data (settings, clip index, thumbnails) predates the rename and
// stores absolute paths, so keep the original data folder instead of moving it.
app.setName('Clutch')
// CLUTCH_USER_DATA runs a separate copy with its own settings and library (demos, testing).
app.setPath('userData', process.env.CLUTCH_USER_DATA || path.join(app.getPath('appData'), 'clipforge'))
if (process.platform === 'win32') app.setAppUserModelId('com.shangkostudio.clutch')

// Serve local clip files and thumbnails to the renderer through a dedicated scheme.
protocol.registerSchemesAsPrivileged([{ scheme: 'cf', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }])

let win: BrowserWindow | null = null
let settings: SettingsStore
let recorder: Recorder
let scheduler: UploadScheduler
let tray: AppTray | null = null
let overlay: OverlayToast | null = null
let mini: MiniWidget | null = null
const updater = new Updater()
let miniHideTimer: NodeJS.Timeout | null = null
let registeredHotkey = ''
const registeredKeys = new Set<string>()
let hotkeySignature = ''
let digest: DailyDigest | null = null
let account: CloudAccount
let sources: LibrarySources
let quitting = false

const TITLEBAR = { color: '#00000000', symbolColor: '#c3c5cc', height: 44 }

/** Windows 11 22H2+ (build 22621) supports acrylic window backgrounds. */
const canAcrylic = process.platform === 'win32' && Number(process.getSystemVersion().split('.')[2] ?? 0) >= 22621

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    // Solid window: the flat design has nothing to show through it.
    backgroundColor: '#121215',
    backgroundMaterial: 'none',
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLEBAR,
    icon: nativeImage.createFromPath(iconPath(256)),
    title: 'Clutch',
    // Not throttled while hidden in the tray: this window captures system audio, and a throttled
    // page delivers it in bursts.
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, backgroundThrottling: false }
  })
  win.once('ready-to-show', () => { if (!settings.get().app.startMinimized && !launchedHidden) win?.show() })
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  // Production UI is served from cf://app/ (a registered secure scheme) rather than file:// so that
  // audio worklets, blob URLs and other secure-context features work.
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadURL('cf://app/index.html')
  win.on('close', (e) => {
    if (!quitting && settings.get().app.minimizeToTray && tray) {
      e.preventDefault()
      win?.hide()
      // First time only: tell people where the app went.
      if (!settings.get().app.trayHintShown) {
        settings.set({ app: { ...settings.get().app, trayHintShown: true } })
        if (Notification.isSupported()) {
          const n = new Notification({ title: 'Clutch is still running', body: 'Find it in the system tray next to the clock (click ^ if it is hidden). Your hotkeys keep working.', icon: nativeImage.createFromPath(iconPath(256)) })
          n.on('click', () => showWindow())
          n.show()
        }
      }
    }
  })
  win.on('closed', () => { win = null; updateMini() })
  for (const ev of ['show', 'hide', 'minimize', 'restore'] as const) win.on(ev as 'show', () => updateMini())
}

const mainVisible = () => !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()

/**
 * The corner controller is up whenever a session (recording or paused) is going and the main
 * window is out of the way. Hiding waits a moment so quick internal restarts don't make it blink.
 */
function updateMini() {
  if (!mini || !settings || !recorder) return
  const st = recorder.status
  const active = st.running || !!st.paused || !!st.starting
  const want = settings.get().app.miniWidget && active && !mainVisible()
  if (want) {
    if (miniHideTimer) { clearTimeout(miniHideTimer); miniHideTimer = null }
    mini.show()
  } else if (mainVisible() || !settings.get().app.miniWidget) {
    if (miniHideTimer) { clearTimeout(miniHideTimer); miniHideTimer = null }
    mini.hide()
  } else if (!miniHideTimer) {
    miniHideTimer = setTimeout(() => { miniHideTimer = null; if (!(recorder.status.running || recorder.status.paused || recorder.status.starting)) mini?.hide() }, 1500)
  }
}

/** "If we start recording, Clutch shrinks": tuck the window away and let the controller take over. */
function shrinkToWidget() {
  const a = settings.get().app
  if (!a.miniWidget || !a.onboarded || !win || !mainVisible()) return
  if (a.minimizeToTray && tray) win.hide()
  else win.minimize()
  updateMini()
}

function showWindow(page?: string) {
  if (!win) createWindow()
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  if (page) send('navigate', page)
}

/**
 * Windows login item. The installed app registers itself; a dev copy registers electron.exe with
 * the project folder, so it starts the last build. A fixed name, so there is only ever one entry
 * and the uninstaller can find it (build/installer.nsh).
 */
function loginItem(): Electron.Settings {
  return app.isPackaged
    ? { args: ['--hidden'], name: 'Clutch' }
    : { path: process.execPath, args: [app.getAppPath(), '--hidden'], name: 'Clutch' }
}
function launchAtLoginIsOn(): boolean {
  return app.getLoginItemSettings(loginItem() as Electron.LoginItemSettingsOptions).openAtLogin
}
function applyLaunchAtLogin(on: boolean) {
  if (process.platform !== 'win32') return
  app.setLoginItemSettings({ ...loginItem(), openAtLogin: on })
}

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

const hotkeySig = (s: Settings) => JSON.stringify([s.capture.clipHotkey, s.capture.extraHotkeys, s.capture.lengthUpHotkey, s.capture.lengthDownHotkey, s.capture.longRecordHotkey, s.capture.bookmarkHotkey])
/** Launched by Windows at login: stay in the tray. */
const launchedHidden = process.argv.includes('--hidden')

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
  reg(s.capture.longRecordHotkey, () => void recorder.toggleLong())
  reg(s.capture.bookmarkHotkey, () => recorder.bookmark())
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
  account = new CloudAccount(() => settings.get().cloud.serverUrl)
  scheduler.gate = () => ({ ok: account.state.signedIn, slots: account.state.plan?.features.autoUploadSlots ?? 1 })
  // Screen watching through the account when there is no personal AI key.
  let quotaNoticeDay = ''
  const syncCloudVision = () => {
    if (!account.state.signedIn) return recorder.setCloudVision(null)
    recorder.setCloudVision(async (req) => {
      try {
        const r = await account.api<{ verdict: import('./triggers/vision').VisionVerdict | null; left: number }>('POST', '/api/vision/judge', req)
        return r.verdict
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const day = new Date().toDateString()
        if (/today's screen checks/i.test(msg) && quotaNoticeDay !== day) { quotaNoticeDay = day; recorder.log('info', msg) }
        else if (!/today's screen checks/i.test(msg)) recorder.log('error', `Screen check failed: ${msg}`)
        return null
      }
    })
  }
  account.on('change', (st) => { send('account', st); tray?.refresh(); syncCloudVision() })
  void account.refresh()
  setInterval(() => void account.refresh(), 10 * 60_000).unref()
  let lastServer = settings.get().cloud.serverUrl
  settings.onChange((s) => { if (s.cloud.serverUrl !== lastServer) { lastServer = s.cloud.serverUrl; void account.refresh() } })

  /** Upload a web-friendly copy of a clip and remember its share link. */
  const shareToCloud = async (clipId: string, onProgress?: (f: number) => void) => {
    const clip = recorder.library.get(clipId)
    if (!clip) throw new Error('Clip not found')
    if (!account.state.signedIn) throw new Error('Sign in to use cloud features')
    if (clip.cloud?.shareUrl && (!clip.cloud.expires || clip.cloud.expires > Date.now())) return clip.cloud
    const maxMb = Math.floor((account.state.plan?.maxClipBytes ?? 100 * 1024 ** 2) / 1024 ** 2)
    recorder.log('upload', `Preparing "${clip.title}" for the cloud…`, clip.id)
    const { file } = await makeShareable(clip, Math.min(maxMb, 1000), path.join(dataDir, 'share'))
    let last = 0
    const res = await account.uploadClip({ title: clip.title, game: clip.game, duration: clip.durationSec, width: clip.width, height: clip.height }, file, clip.thumbnail, (f) => {
      if (Date.now() - last > 300) { last = Date.now(); send('cloud-progress', { clipId, progress: f }); onProgress?.(f) }
    })
    const cloud = { id: res.id, shareUrl: res.shareUrl, uploadedAt: new Date().toISOString(), expires: res.expires }
    recorder.library.update(clip.id, { cloud })
    send('cloud-progress', { clipId, progress: 1 })
    recorder.log('upload', `Share link ready for "${clip.title}": ${res.shareUrl}`, clip.id)
    return cloud
  }

  // Pro: back up favorites in the background, one at a time.
  let backingUp = false
  setInterval(async () => {
    const st = account.state
    if (backingUp || !st.signedIn || !st.plan?.features.cloudBackup || !settings.get().cloud.backupFavorites) return
    const next = recorder.library.all().find((c) => c.favorite && !c.cloud && c.trigger !== 'long')
    if (!next) return
    backingUp = true
    try { await shareToCloud(next.id) } catch (e) { recorder.log('error', `Cloud backup paused: ${e instanceof Error ? e.message : String(e)}`) } finally { backingUp = false }
  }, 90_000).unref()
  overlay = new OverlayToast()
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  mini = new MiniWidget({
    url: rendererUrl ? `${rendererUrl}#mini` : 'cf://app/index.html#mini',
    preload: path.join(__dirname, '../preload/index.js'),
    getAnchor: () => settings.get().app.miniWidgetAnchor ?? undefined,
    saveAnchor: (a) => settings.set({ app: { ...settings.get().app, miniWidgetAnchor: a } })
  })
  overlay.avoid = () => mini?.bounds ?? null

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
    // Only serve clips, thumbnails and icons: the clips folder, the app's data folder,
    // and any folder that already holds a library clip (e.g. an older clips folder).
    const file = path.normalize(rel)
    const roots = [settings.get().capture.outputDir, app.getPath('userData'), ...(settings.get().libraries ?? []).map((l) => l.path), ...new Set(recorder.library.own().map((c) => path.dirname(path.dirname(c.file))))]
    if (!isInside(file, roots)) return new Response('forbidden', { status: 403 })
    return serveFile(file, req)
  })

  // System audio: the renderer calls getDisplayMedia({audio:true}) and we hand it the screen + loopback audio.
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
      .then((sources) => cb({ video: sources[0], audio: 'loopback' }))
      .catch(() => cb({}))
  })

  recorder.on('status', (st) => {
    send('status', st)
    mini?.send('status', st)
    tray?.refresh({ running: st.running, game: st.game })
    updateMini()
  })
  recorder.on('autoStarted', () => shrinkToWidget())
  recorder.on('activity', (ev) => send('activity', ev))
  let lastLevels = 0
  recorder.on('levels', (l) => {
    // Only to windows that show meters right now; nobody sees them in the tray.
    const toMini = !!mini?.visible && mini.isExpanded
    if (!mainVisible() && !toMini) return
    const now = Date.now()
    if (now - lastLevels < 90) return
    lastLevels = now
    if (mainVisible()) send('levels', l)
    if (toMini) mini!.send('levels', l)
  })
  recorder.on('clip', (clip) => {
    send('clip-saved', clip)
    mini?.send('clip-saved', clip)
    if (settings.get().app.overlayToasts) overlay?.show('Clipped!', `${clip.game} · ${Math.round(clip.durationSec)}s`, 'clip')
  })
  recorder.on('game', (g) => { send('game', g); tray?.refresh() })
  recorder.on('notice', (n) => overlay?.show(n.title, n.sub, n.kind, 2200))
  recorder.library.on('change', () => send('library-changed', null))
  // Other clip libraries (Medal, any folder), read in place.
  sources = new LibrarySources(recorder.library, settings, () => settings.get().capture.outputDir)
  sources.on('change', (list) => send('libraries', list))
  sources.on('log', (m) => recorder.log('info', m))
  setTimeout(() => sources.scanAll(), 45_000)
  setInterval(() => sources.scanAll(), 30 * 60_000)
  scheduler.on('change', () => send('uploads-changed', null))
  scheduler.on('log', (m) => recorder.log('upload', m))
  scheduler.on('done', ({ clip, upload }) => send('upload-done', { clipId: clip.id, url: upload.url, title: clip.title }))
  // Keep the Windows startup entry matching the setting (and pointing at this copy).
  if (process.platform === 'win32' && settings.get().app.launchAtLogin) applyLaunchAtLogin(true)
  settings.onChange((s) => {
    if (hotkeySig(s) !== hotkeySignature) registerHotkey(s)
    tray?.refresh()
    if (process.platform === 'win32' && launchAtLoginIsOn() !== s.app.launchAtLogin) applyLaunchAtLogin(s.app.launchAtLogin)
    // Keep the window in sync with changes made by the main process (YouTube connect, tray, etc.).
    send('settings-changed', s)
    mini?.send('settings-changed', s)
    updateMini()
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
  ipcMain.handle('system:runningApps', () => listRunningApps(settings.get().extraGames ?? [], settings.get().allowlist))
  ipcMain.handle('game:use', async (_e, app: { process: string; title: string; exePath: string; pid?: number }) => {
    await recorder.useGame(app, 'manual')
    if (recorder.status.running) shrinkToWidget()
    return recorder.status
  })
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
  ipcMain.handle('update:state', () => updater.state)
  ipcMain.handle('update:check', () => updater.check())
  // ---- Editor: crop / vertical / speed / captions, and joining clips. Results are new clips.
  const editorProgress = (clipId: string) => (stage: string, f: number) => send('editor-progress', { clipId, stage, progress: f })
  ipcMain.handle('editor:captionModel', async () => (await import('./editor')).captionModelReady())
  ipcMain.handle('editor:downloadCaptionModel', async () => {
    const ed = await import('./editor')
    await ed.downloadCaptionModel((f) => send('editor-progress', { clipId: '*model', stage: 'Downloading speech model', progress: f }))
    return ed.captionModelReady()
  })
  ipcMain.handle('editor:export', async (_e, clipId: string, opts: import('../shared/types').EditOptions) => {
    const clip = recorder.library.get(clipId)
    if (!clip) throw new Error('Clip not found')
    const { exportEdit } = await import('./editor')
    const out = await exportEdit(clip, opts, editorProgress(clipId), outputDirFor(clip, settings.get().capture.outputDir))
    const added = await recorder.library.add(out.file, { game: clip.game, gameProcess: clip.gameProcess, gameIcon: clip.gameIcon, trigger: 'manual', title: out.title, tags: clip.tags })
    recorder.log('clip', `Exported "${added.title}"`, added.id)
    return added
  })
  ipcMain.handle('editor:join', async (_e, ids: string[]) => {
    const clips = ids.map((id) => recorder.library.get(id)).filter((c): c is NonNullable<typeof c> => !!c).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    const { joinClips } = await import('./editor')
    const out = await joinClips(clips, (f) => send('editor-progress', { clipId: '*join', stage: 'Joining', progress: f }), outputDirFor(clips[0], settings.get().capture.outputDir))
    const games = [...new Set(clips.map((c) => c.game))]
    const added = await recorder.library.add(out.file, { game: games.length === 1 ? games[0] : 'Montage', gameIcon: games.length === 1 ? clips[0].gameIcon : undefined, trigger: 'manual', title: out.title })
    recorder.log('clip', `Joined ${clips.length} clips into "${added.title}"`, added.id)
    return added
  })
  ipcMain.handle('update:install', () => updater.install())
  // Waveform for the clip viewer's timeline, cached next to the thumbnail.
  ipcMain.handle('library:waveform', async (_e, clipId: string) => {
    const clip = recorder.library.get(clipId)
    if (!clip) return []
    const cache = clip.thumbnail.replace(/\.jpg$/i, '') + '.wave.json'
    try { return JSON.parse((await import('node:fs')).readFileSync(cache, 'utf8')) as number[] } catch { /* not cached yet */ }
    const { audioPeaks } = await import('./capture/ffmpeg')
    const peaks = await audioPeaks(clip.file, clip.durationSec)
    if (peaks.length) { try { (await import('node:fs')).writeFileSync(cache, JSON.stringify(peaks)) } catch { /* read-only */ } }
    return peaks
  })
  ipcMain.handle('system:diskInfo', async (_e, dir: string) => (await import('./library/janitor')).diskInfo(dir || settings.get().capture.outputDir))
  ipcMain.handle('system:diskFree', async (_e, dir: string) => {
    const { freeBytes } = await import('./library/janitor')
    return freeBytes(dir || settings.get().capture.outputDir)
  })
  ipcMain.handle('account:get', () => account.state)
  ipcMain.handle('account:refresh', async () => { await account.refresh(); return account.state })
  ipcMain.handle('account:providers', () => account.providers())
  ipcMain.handle('account:signIn', async (_e, provider: string) => { const st = await account.signIn(provider); showWindow(); return st })
  ipcMain.handle('account:lastAuthUrl', () => account.lastAuthUrl)
  ipcMain.handle('account:signOut', () => account.signOut())
  ipcMain.handle('account:checkout', () => account.checkout())
  ipcMain.handle('account:portal', () => account.portal())
  ipcMain.handle('account:devPlan', (_e, plan: 'free' | 'pro') => account.devPlan(plan))
  ipcMain.handle('cloud:share', (_e, clipId: string) => shareToCloud(clipId))
  ipcMain.handle('cloud:unshare', async (_e, clipId: string) => {
    const clip = recorder.library.get(clipId)
    if (clip?.cloud) { await account.deleteCloud(clip.cloud.id).catch(() => undefined); recorder.library.update(clipId, { cloud: undefined }) }
  })
  ipcMain.handle('ads:get', (_e, placement: string) => {
    const st = account.state
    if (!settings.get().app.showAds || st.plan?.features.adFree) return []
    return account.ads(placement)
  })
  ipcMain.handle('ads:open', (_e, ad: { id: string; url: string }) => {
    account.adClick(ad.id)
    if (ad.url === 'clutch://pro') { showWindow('settings'); send('open-pro', null); return }
    if (/^https:\/\//.test(ad.url)) void shell.openExternal(ad.url)
  })
  ipcMain.handle('capture:monitors', () => screen.getAllDisplays().map((d, i) => ({ index: i, label: d.label || `Monitor ${i + 1}`, width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor), primary: d.id === screen.getPrimaryDisplay().id })))
  ipcMain.handle('capture:pickRegion', async (_e, monitorIndex: number) => {
    win?.hide()
    try { return await pickRegion(monitorIndex) } finally { showWindow() }
  })
  ipcMain.handle('capture:restart', async () => { await recorder.stop('manual'); await recorder.start('manual') })
  ipcMain.handle('window:minimize', () => win?.minimize())
  ipcMain.handle('window:hide', () => win?.hide())

  ipcMain.handle('buffer:start', async () => { if (await recorder.start('manual')) shrinkToWidget() })
  ipcMain.handle('buffer:stop', () => recorder.stop('manual'))
  ipcMain.handle('buffer:togglePause', () => recorder.togglePause())
  // Bring settings over from Medal / OBS / NVIDIA (nothing is changed until the user applies).
  const toBuffers = (images: ArrayBuffer[]) => images.slice(0, 4).map((a) => Buffer.from(a))
  ipcMain.handle('import:hasObs', () => hasObs())
  ipcMain.handle('import:obs', async () => {
    const found = readObs()
    if (!found) throw new Error('No OBS profile was found on this PC')
    return proposeChanges(found, settings.get(), 'obs-files')
  })
  ipcMain.handle('import:screenshots', async (_e, images: ArrayBuffer[]) => {
    const { found, lines } = await readScreenshots(toBuffers(images), path.join(dataDir, 'tmp'))
    return proposeChanges(found, settings.get(), 'text', lines)
  })
  /** Smart read: your own key if you have one, otherwise the Clutch server for signed-in users. */
  ipcMain.handle('import:smart', async (_e, images: ArrayBuffer[]) => {
    const imgs = forSmartRead(toBuffers(images))
    const s = settings.get()
    let found
    if (s.ai.anthropicApiKey || process.env.ANTHROPIC_API_KEY) {
      found = await smartReadLocal({ apiKey: s.ai.anthropicApiKey, model: s.ai.model, images: imgs })
    } else {
      if (!account.state.signedIn) throw new Error('SIGN_IN')
      const r = await account.api<{ settings: Parameters<typeof fromModel>[0]; left: number }>('POST', '/api/import/read', { images: imgs })
      found = fromModel(r.settings)
      if (r.left <= 1) found.notes.push(r.left ? '1 smart read left today' : 'That was your last smart read today')
    }
    return proposeChanges(found, s, 'smart')
  })
  ipcMain.handle('import:apply', (_e, changes: import('../shared/types').ImportChange[]) => {
    const cur = settings.get()
    const next = settings.set({ capture: applyChanges(cur.capture, changes) })
    const n = changes.filter((c) => c.on).length
    recorder.log('info', `Imported ${n} setting${n === 1 ? '' : 's'}`)
    return next
  })
  // Corner controller
  ipcMain.handle('mini:expand', (_e, on?: boolean) => { mini?.setExpanded(on ?? !mini.isExpanded); return mini?.isExpanded ?? false })
  ipcMain.handle('mini:openMain', () => showWindow('dashboard'))
  ipcMain.on('mini:drag', (_e, phase: 'start' | 'move' | 'end') => {
    if (phase === 'start') mini?.dragStart()
    else if (phase === 'move') mini?.dragMove()
    else mini?.dragEnd()
  })
  const previewFile = path.join(dataDir, 'mini-preview.jpg')
  let previewBusy = false
  ipcMain.handle('mini:preview', async () => {
    if (previewBusy) return null
    previewBusy = true
    try {
      const r = await recorder.buffer.previewFrame(previewFile)
      if (!r.ok) return null
      const { readFile } = await import('node:fs/promises')
      return { dataUrl: `data:image/jpeg;base64,${(await readFile(previewFile)).toString('base64')}`, atMs: r.atMs }
    } catch { return null } finally { previewBusy = false }
  })
  ipcMain.handle('buffer:status', () => recorder.status)
  ipcMain.handle('clip:now', () => recorder.clipNow('manual'))
  ipcMain.handle('long:toggle', async () => {
    const wasActive = recorder.status.running || !!recorder.status.paused
    await recorder.toggleLong()
    if (!wasActive && recorder.status.running) shrinkToWidget()
  })
  ipcMain.handle('bookmark:add', () => recorder.bookmark())
  ipcMain.handle('system:canLaunchAtLogin', () => process.platform === 'win32')
  ipcMain.handle('activity:list', () => recorder.activity)
  ipcMain.on('audio:push', (_e, pcm: ArrayBuffer, levelDb: number) => recorder.pushSystemAudio(Buffer.from(pcm), levelDb))

  ipcMain.handle('library:query', (_e, q: LibraryQuery) => recorder.library.query(q))
  ipcMain.handle('libraries:list', () => sources.list())
  ipcMain.handle('libraries:detectMedal', async () => {
    const dir = await detectMedal()
    if (!dir) return null
    const already = (settings.get().libraries ?? []).some((l) => path.resolve(l.path).toLowerCase() === path.resolve(dir).toLowerCase())
    return { path: dir, added: already }
  })
  ipcMain.handle('libraries:addMedal', async () => {
    const dir = await detectMedal()
    if (!dir) throw new Error("Couldn't find Medal's clips folder. Use Add folder and pick it yourself.")
    return sources.add(dir, 'medal')
  })
  ipcMain.handle('libraries:addFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Add a folder of clips', defaultPath: app.getPath('videos'), properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    return sources.add(r.filePaths[0])
  })
  ipcMain.handle('libraries:remove', (_e, id: string) => sources.remove(id))
  ipcMain.handle('libraries:rename', (_e, id: string, name: string) => sources.rename(id, name))
  ipcMain.handle('libraries:rescan', (_e, id?: string) => (id ? sources.scan(id) : sources.scanAll()))
  ipcMain.handle('libraries:open', (_e, id: string) => { const l = (settings.get().libraries ?? []).find((x) => x.id === id); if (l) void shell.openPath(l.path) })
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
    // A new file, never the clip's own path; another library's videos are trimmed into Clutch's folder.
    const out = path.join(outputDirFor(clip, settings.get().capture.outputDir), `${baseName(clip.file)} trim ${Math.round(startSec)}-${Math.round(endSec)}.mp4`)
    const ok = await trimClip(clip.file, out, startSec, endSec)
    if (!ok) throw new Error('Trim failed')
    if (mode === 'replace') {
      const added = await recorder.library.add(out, { game: clip.game, gameProcess: clip.gameProcess, gameIcon: clip.gameIcon, trigger: clip.trigger, event: clip.event, title: clip.title, tags: clip.tags })
      recorder.library.update(added.id, { favorite: clip.favorite })
      recorder.library.remove(clip.id)
      return added
    }
    // A piece cut out of a long recording is a normal clip (shows in Clip of the day, not under Long).
    return recorder.library.add(out, { game: clip.game, gameProcess: clip.gameProcess, gameIcon: clip.gameIcon, trigger: clip.trigger === 'long' ? 'manual' : clip.trigger, event: clip.event, title: `${clip.title} (trimmed)`, tags: clip.tags })
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

  scheduler.youtubeAccountToken = async () => (await account.api<{ accessToken: string }>('POST', '/api/youtube/token')).accessToken
  const setYouTube = (patch: Partial<Settings['upload']['youtube']>) => settings.set({ upload: { ...settings.get().upload, youtube: { ...settings.get().upload.youtube, ...patch } } })
  /** One click: sign in with Google through the Clutch account. `own` uses the user's own Google app. */
  ipcMain.handle('youtube:connect', async (_e, mode: 'account' | 'own' = 'account') => {
    if (mode === 'own') {
      const r = await scheduler.youtube().connect()
      setYouTube({ connected: true, channelTitle: r.channelTitle, via: 'own' })
      return r
    }
    if (!account.state.signedIn) throw new Error('SIGN_IN')
    const { url } = await account.api<{ url: string }>('POST', '/api/youtube/connect')
    void shell.openExternal(url)
    // Wait for the browser consent to finish on the server (up to 5 minutes).
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const st = await account.api<{ connected: boolean; channel: string | null }>('GET', '/api/youtube').catch(() => null)
      if (st?.connected) {
        setYouTube({ connected: true, channelTitle: st.channel ?? 'YouTube', via: 'account' })
        showWindow()
        return { channelTitle: st.channel ?? 'YouTube' }
      }
    }
    throw new Error('Timed out waiting for Google. Try again.')
  })
  ipcMain.handle('youtube:disconnect', async () => {
    if (settings.get().upload.youtube.via === 'account') await account.api('POST', '/api/youtube/disconnect').catch(() => undefined)
    else scheduler.youtube().disconnect()
    setYouTube({ connected: false, channelTitle: undefined, via: undefined })
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
    show: (page) => showWindow(page),
    toggleLong: () => void recorder.toggleLong(),
    bookmark: () => recorder.bookmark(),
    isLong: () => !!recorder.longRecording,
    hotkeys: () => ({ clip: settings.get().capture.clipHotkey, long: settings.get().capture.longRecordHotkey, bookmark: settings.get().capture.bookmarkHotkey }),
    launchAtLogin: () => ({ enabled: settings.get().app.launchAtLogin, available: app.isPackaged && process.platform === 'win32' }),
    setLaunchAtLogin: (on) => { settings.set({ app: { ...settings.get().app, launchAtLogin: on } }) },
    startStop: () => void (recorder.status.running || recorder.isPaused ? recorder.stop('manual') : recorder.start('manual').then((ok) => { if (ok) shrinkToWidget() })),
    isPaused: () => recorder.isPaused,
    updateReady: () => (updater.state.phase === 'ready' ? updater.state.version ?? null : null),
    installUpdate: () => updater.install(),
    missedGame: () => {
      const a = recorder.lastApp
      return a && !a.isGame ? { name: a.name, process: a.process } : null
    },
    treatAsGame: (p) => recorder.treatAsGame(p),
    togglePause: () => void recorder.togglePause(),
    clipNow: () => void recorder.clipNow('manual'),
    lengths: () => ({ options: recorder.lengthOptions(), current: recorder.effectiveCapture().preSeconds }),
    setLength: (n: number) => { recorder.setClipLength(n); announceLength({ seconds: n, edge: null }) },
    quit: () => { quitting = true; app.quit() },
    isRunning: () => recorder.status.running
  })

  createWindow()
  registerHotkey(settings.get())
  scheduler.start()
  updater.on('change', (st) => { send('update', st); tray?.refresh() })
  // Storage saver: shrink clips in the background while not recording.
  if ((settings.get().storage.shrink ?? 'auto') === 'auto' && !settings.get().storage.shrinkSince) settings.set({ storage: { ...settings.get().storage, shrinkSince: Date.now() } })
  const compressor = new Compressor(recorder.library, () => settings.get(), () => recorder.status.running || !!recorder.status.starting, (m) => recorder.log('info', m))
  compressor.on('progress', (p) => send('shrink-progress', p))
  recorder.on('status', (st) => { if (st.running || st.starting) compressor.pauseForRecording() })
  settings.onChange((s) => { if ((s.storage.shrink ?? 'auto') === 'auto' && !s.storage.shrinkSince) settings.set({ storage: { ...s.storage, shrinkSince: Date.now() } }) })
  compressor.start()
  ipcMain.handle('storage:shrinkState', () => {
    const existing = compressor.candidates(true)
    return { progress: compressor.progress, existingCount: existing.length, existingBytes: existing.reduce((n, c) => n + (c.sizeBytes || 0), 0) }
  })
  ipcMain.handle('storage:shrinkExisting', () => compressor.shrinkExisting())
  ipcMain.handle('library:exportCompatibleMany', async (_e, ids: string[]) => {
    const clips = ids.map((id) => recorder.library.get(id)).filter((c): c is NonNullable<typeof c> => !!c)
    if (!clips.length) return null
    const r = await dialog.showOpenDialog(win!, { title: 'Save MP4 copies to…', defaultPath: app.getPath('videos'), properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const folder = r.filePaths[0]
    const { exportCompatible } = await import('./editor')
    const used = new Set<string>()
    for (const [i, clip] of clips.entries()) {
      let base = clip.title.replace(/[<>:"/\\|?*]+/g, '').trim() || 'Clip'
      for (let n = 2; used.has(base.toLowerCase()); n++) base = `${clip.title.replace(/[<>:"/\\|?*]+/g, '').trim() || 'Clip'} ${n}`
      used.add(base.toLowerCase())
      await exportCompatible(clip, path.join(folder, `${base}.mp4`), (f) => send('editor-progress', { clipId: '*export', stage: `Saving ${i + 1} of ${clips.length} · ${Math.round(f * 100)}%`, progress: f }))
    }
    void shell.openPath(folder)
    return { folder, count: clips.length }
  })
  ipcMain.handle('library:exportCompatible', async (_e, clipId: string) => {
    const clip = recorder.library.get(clipId)
    if (!clip) throw new Error('Clip not found')
    const safe = clip.title.replace(/[<>:"/\\|?*]+/g, '').trim() || 'Clip'
    const r = await dialog.showSaveDialog(win!, { title: 'Save a copy that plays everywhere', defaultPath: path.join(app.getPath('videos'), `${safe}.mp4`), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] })
    if (r.canceled || !r.filePath) return null
    const { exportCompatible } = await import('./editor')
    await exportCompatible(clip, r.filePath, (f) => send('editor-progress', { clipId, stage: 'Saving MP4', progress: f }))
    shell.showItemInFolder(r.filePath)
    return r.filePath
  })
  updater.start()
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
  mini?.destroy()
  digest?.stop()
  disposeForegroundWatcher()
  recorder?.dispose()
  await recorder?.stop('manual')
})
