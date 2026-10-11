import { app, Menu, nativeImage, Tray } from 'electron'
import path from 'node:path'

export type TrayPage = 'dashboard' | 'library' | 'rules' | 'settings'

export interface TrayActions {
  show: (page?: TrayPage) => void
  startStop: () => void
  clipNow: () => void
  quit: () => void
  isRunning: () => boolean
  lengths: () => { options: number[]; current: number }
  setLength: (seconds: number) => void
  toggleLong: () => void
  bookmark: () => void
  isLong: () => boolean
  hotkeys: () => { clip: string; long: string; bookmark: string }
  launchAtLogin: () => { enabled: boolean; available: boolean }
  setLaunchAtLogin: (on: boolean) => void
}

export function iconPath(size: 32 | 256 = 256, variant: '' | '-rec' = ''): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return path.join(base, 'resources', size === 32 ? `icon-32${variant}.png` : 'icon.png')
}

const accel = (k: string) => k || undefined

/** System tray icon: lives next to the clock, keeps working when the window is closed. */
export class AppTray {
  private tray: Tray
  private idle = nativeImage.createFromPath(iconPath(32))
  private rec = nativeImage.createFromPath(iconPath(32, '-rec'))
  private last: { running: boolean; game?: string } | undefined
  private shownRec = false

  constructor(private actions: TrayActions) {
    this.tray = new Tray(this.idle)
    this.tray.setToolTip('Clutch')
    this.tray.on('click', () => actions.show())
    this.tray.on('double-click', () => actions.show())
    this.refresh()
  }

  refresh(status?: { running: boolean; game?: string }) {
    if (status) this.last = status
    const running = status?.running ?? this.last?.running ?? this.actions.isRunning()
    const game = status?.game ?? this.last?.game
    const long = this.actions.isLong()
    const { options, current } = this.actions.lengths()
    const keys = this.actions.hotkeys()
    const login = this.actions.launchAtLogin()

    // Red dot on the tray icon while recording.
    if (running !== this.shownRec && !this.rec.isEmpty()) {
      this.tray.setImage(running ? this.rec : this.idle)
      this.shownRec = running
    }
    const state = long ? `Long recording${game ? ` · ${game}` : ''}` : running ? `Recording${game ? ` · ${game}` : ''}` : 'Waiting for a game'
    this.tray.setToolTip(`Clutch - ${state}`)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: state, enabled: false },
        { type: 'separator' },
        { label: running ? 'Stop recording' : 'Start recording', click: () => this.actions.startStop() },
        { label: 'Clip now', enabled: running, accelerator: accel(keys.clip), registerAccelerator: false, click: () => this.actions.clipNow() },
        { label: long ? 'Stop long recording' : 'Start long recording', accelerator: accel(keys.long), registerAccelerator: false, click: () => this.actions.toggleLong() },
        { label: 'Bookmark this moment', enabled: long, accelerator: accel(keys.bookmark), registerAccelerator: false, click: () => this.actions.bookmark() },
        {
          label: `Clip length (${current}s)`,
          submenu: options.map((n) => ({ label: n >= 60 && n % 60 === 0 ? `${n / 60} min` : `${n} seconds`, type: 'radio' as const, checked: n === current, click: () => this.actions.setLength(n) }))
        },
        { type: 'separator' },
        { label: 'Open Clutch', click: () => this.actions.show('dashboard') },
        { label: 'My clips', click: () => this.actions.show('library') },
        { label: 'What to clip', click: () => this.actions.show('rules') },
        { label: 'Settings', click: () => this.actions.show('settings') },
        { type: 'separator' },
        { label: login.available ? 'Start with Windows' : 'Start with Windows (installed app only)', type: 'checkbox', checked: login.enabled, enabled: login.available, click: (item) => this.actions.setLaunchAtLogin(item.checked) },
        { label: 'Quit Clutch', click: () => this.actions.quit() }
      ])
    )
  }

  destroy() {
    this.tray.destroy()
  }
}
