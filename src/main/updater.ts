import { app } from 'electron'
import { EventEmitter } from 'node:events'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

export interface UpdateState {
  /** Version downloaded and ready to install on restart. */
  ready?: string
  checking?: boolean
  error?: string
}

/**
 * Auto-update from GitHub Releases (latest.yml published by `npm run release`). Updates download
 * quietly and install when Clutch quits, or right away if the user clicks Restart. Never restarts
 * on its own, so a recording is never cut off. Only active in the installed app.
 */
export class Updater extends EventEmitter<{ change: [UpdateState] }> {
  state: UpdateState = {}
  private timer: NodeJS.Timeout | null = null

  start() {
    if (!app.isPackaged || process.env.CLUTCH_NO_UPDATES) return
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-downloaded', (info) => this.set({ ready: info.version, checking: false, error: undefined }))
    autoUpdater.on('error', (e) => this.set({ checking: false, error: e instanceof Error ? e.message : String(e) }))
    const check = () => { this.set({ checking: true }); autoUpdater.checkForUpdates().catch(() => undefined).finally(() => this.set({ checking: false })) }
    setTimeout(check, 30_000)
    this.timer = setInterval(check, 6 * 60 * 60_000)
  }

  /** Restart now and install the downloaded update. */
  install() {
    if (this.state.ready) autoUpdater.quitAndInstall(true, true)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch }
    this.emit('change', this.state)
  }
}
