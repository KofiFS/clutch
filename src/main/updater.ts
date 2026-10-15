import { app } from 'electron'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/types'

const { autoUpdater } = electronUpdater

/**
 * Auto-update from GitHub Releases (latest.yml published by the release workflow). Updates are
 * checked a little after start and every 6 hours, download quietly, and install when Clutch quits,
 * or right away when the user clicks Restart. Never restarts on its own, so a recording is never
 * cut off. The Settings "Check for updates" button runs the same check on demand.
 *
 * Only the installed app updates itself (a dev copy runs from source; a Store copy is updated by
 * the Store). CLUTCH_TEST_UPDATES=1 lets a dev copy check and download against the real GitHub
 * releases for testing, without installing.
 */
export class Updater extends EventEmitter<{ change: [UpdateState] }> {
  state: UpdateState = { phase: 'idle', current: app.getVersion() }
  private timer: NodeJS.Timeout | null = null
  private started = false
  private readonly testing = !app.isPackaged && process.env.CLUTCH_TEST_UPDATES === '1'

  /** Why this copy can't update itself, if it can't. */
  private unsupported(): string | undefined {
    if (process.env.CLUTCH_NO_UPDATES) return 'Updates are turned off for this copy.'
    if (process.windowsStore) return 'The Microsoft Store keeps this copy up to date.'
    if (!app.isPackaged && !this.testing) return 'This copy runs from source code, so it updates when you pull new code. The installed app updates itself.'
    return undefined
  }

  start() {
    const why = this.unsupported()
    if (why) { this.set({ phase: 'unsupported', message: why }); return }
    this.started = true
    if (this.testing) {
      // A dev copy has no app-update.yml (the installer writes it); give it one pointing at the
      // real releases, in the temp folder.
      const cfg = path.join(os.tmpdir(), 'clutch-dev-app-update.yml')
      fs.writeFileSync(cfg, ['provider: github', 'owner: KofiFS', 'repo: clutch', 'updaterCacheDirName: clutch-updater-test', ''].join('\n'))
      autoUpdater.forceDevUpdateConfig = true
      autoUpdater.updateConfigPath = cfg
      autoUpdater.autoInstallOnAppQuit = false
    } else {
      autoUpdater.autoInstallOnAppQuit = true
    }
    autoUpdater.autoDownload = true
    autoUpdater.on('checking-for-update', () => this.set({ phase: 'checking', message: undefined }))
    autoUpdater.on('update-available', (info) => this.set({ phase: 'downloading', version: info.version, progress: 0 }))
    autoUpdater.on('download-progress', (p) => this.set({ phase: 'downloading', progress: p.percent / 100 }))
    autoUpdater.on('update-not-available', () => this.set({ phase: 'up-to-date', checkedAt: new Date().toISOString(), version: undefined }))
    autoUpdater.on('update-downloaded', (info) => this.set({ phase: 'ready', version: info.version, progress: 1, checkedAt: new Date().toISOString() }))
    autoUpdater.on('error', (e) => this.set({ phase: 'error', message: friendlyError(e) }))
    setTimeout(() => void this.check(), 30_000)
    this.timer = setInterval(() => void this.check(), 6 * 60 * 60_000)
  }

  /** Check now (the Settings button). Downloads right away when there is a new version. */
  async check(): Promise<UpdateState> {
    if (!this.started) return this.state
    if (this.state.phase === 'checking' || this.state.phase === 'downloading' || this.state.phase === 'ready') return this.state
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      this.set({ phase: 'error', message: friendlyError(e) })
    }
    return this.state
  }

  /** Restart now and install the downloaded update. */
  install() {
    if (this.state.phase !== 'ready' || this.testing) return
    autoUpdater.quitAndInstall(true, true)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch }
    this.emit('change', this.state)
  }
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_|EAI_AGAIN|socket hang up/i.test(msg)) return "Couldn't reach GitHub. Check your internet connection and try again."
  if (/404/.test(msg)) return 'No published release was found yet.'
  if (/rate limit|403/i.test(msg)) return 'GitHub is busy right now. Try again in a few minutes.'
  return msg.split('\n')[0].slice(0, 200)
}
