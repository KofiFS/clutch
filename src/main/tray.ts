import { app, Menu, nativeImage, Tray } from 'electron'
import path from 'node:path'

export interface TrayActions {
  show: () => void
  startStop: () => void
  clipNow: () => void
  quit: () => void
  isRunning: () => boolean
  lengths: () => { options: number[]; current: number }
  setLength: (seconds: number) => void
}

export function iconPath(size: 32 | 256 = 256): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return path.join(base, 'resources', size === 32 ? 'icon-32.png' : 'icon.png')
}

/** System tray icon with the three things you need while a game is open. */
export class AppTray {
  private tray: Tray

  constructor(private actions: TrayActions) {
    this.tray = new Tray(nativeImage.createFromPath(iconPath(32)))
    this.tray.setToolTip('Clutch')
    this.tray.on('click', () => actions.show())
    this.tray.on('double-click', () => actions.show())
    this.refresh()
  }

  private last: { running: boolean; game?: string } | undefined

  refresh(status?: { running: boolean; game?: string }) {
    if (status) this.last = status
    const running = status?.running ?? this.last?.running ?? this.actions.isRunning()
    const game = status?.game ?? this.last?.game
    const { options, current } = this.actions.lengths()
    this.tray.setToolTip(running ? `Clutch - recording ${game ?? ''}`.trim() : 'Clutch - idle')
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: running ? `Recording ${game ?? ''}`.trim() : 'Not recording', enabled: false },
        { type: 'separator' },
        { label: 'Open Clutch', click: () => this.actions.show() },
        { label: running ? 'Stop recording' : 'Start recording', click: () => this.actions.startStop() },
        { label: 'Clip now', enabled: running, click: () => this.actions.clipNow() },
        {
          label: `Clip length (${current}s)`,
          submenu: options.map((n) => ({ label: n >= 60 && n % 60 === 0 ? `${n / 60} min` : `${n} seconds`, type: 'radio' as const, checked: n === current, click: () => this.actions.setLength(n) }))
        },
        { type: 'separator' },
        { label: 'Quit', click: () => this.actions.quit() }
      ])
    )
  }

  destroy() {
    this.tray.destroy()
  }
}
