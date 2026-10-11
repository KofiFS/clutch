import { app, Menu, nativeImage, Tray } from 'electron'
import path from 'node:path'

export interface TrayActions {
  show: () => void
  startStop: () => void
  clipNow: () => void
  quit: () => void
  isRunning: () => boolean
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
    this.tray.setToolTip('ClipForge')
    this.tray.on('click', () => actions.show())
    this.tray.on('double-click', () => actions.show())
    this.refresh()
  }

  refresh(status?: { running: boolean; game?: string }) {
    const running = status?.running ?? this.actions.isRunning()
    this.tray.setToolTip(running ? `ClipForge - recording ${status?.game ?? ''}`.trim() : 'ClipForge - idle')
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: running ? `Recording ${status?.game ?? ''}`.trim() : 'Not recording', enabled: false },
        { type: 'separator' },
        { label: 'Open ClipForge', click: () => this.actions.show() },
        { label: running ? 'Stop recording' : 'Start recording', click: () => this.actions.startStop() },
        { label: 'Clip now', enabled: running, click: () => this.actions.clipNow() },
        { type: 'separator' },
        { label: 'Quit', click: () => this.actions.quit() }
      ])
    )
  }

  destroy() {
    this.tray.destroy()
  }
}
