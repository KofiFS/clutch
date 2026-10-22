import { BrowserWindow, screen } from 'electron'

/** Window sizes include an 8 px margin around the panel for its shadow. */
const SIZE = { compact: { w: 332, h: 76 }, expanded: { w: 392, h: 420 } }
const MARGIN = 16
/** Default distance from the top: clear of a windowed game's title-bar buttons (its X sits in the top-right corner). */
const TOP_OFFSET = 72

export interface MiniWidgetOptions {
  url: string
  preload: string
  /** Saved top-right corner (screen DIP), if the user moved the widget before. */
  getAnchor: () => { right: number; top: number } | undefined
  saveAnchor: (a: { right: number; top: number }) => void
}

/**
 * The small "recording" controller that sits in the top-right corner while Clutch is minimized.
 *
 * It is excluded from screen capture (SetWindowDisplayAffinity WDA_EXCLUDEFROMCAPTURE through
 * setContentProtection), so the user sees it but clips never do. It never takes focus, so clicking
 * it does not pull the game out of the foreground.
 */
export class MiniWidget {
  private win: BrowserWindow | null = null
  private expanded = false
  private drag: { cx: number; cy: number; x: number; y: number } | null = null
  /** Top-right corner the widget is pinned to, so expanding grows left/down from it. */
  private anchor: { right: number; top: number } | null = null

  constructor(private opts: MiniWidgetOptions) {}

  get isExpanded() {
    return this.expanded
  }

  get visible() {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible()
  }

  /** Where it is on screen while visible (the "Clipped!" toast goes underneath). */
  get bounds() {
    return this.visible ? this.win!.getBounds() : null
  }

  get webContents() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const { w, h } = SIZE.compact
    const win = new BrowserWindow({
      width: w,
      height: h,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      title: 'Clutch recording controls',
      webPreferences: { preload: this.opts.preload, sandbox: false, contextIsolation: true, backgroundThrottling: false }
    })
    // Visible to the user, invisible to every screen recorder, Clutch's own included.
    win.setContentProtection(true)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    void win.loadURL(this.opts.url)
    win.on('closed', () => { this.win = null })
    this.win = win
    return win
  }

  /** Default spot: top-right of the primary screen's work area. Saved spots must still be on a screen. */
  private resolveAnchor(): { right: number; top: number } {
    if (this.anchor) return this.anchor
    const saved = this.opts.getAnchor()
    if (saved) {
      const onScreen = screen.getAllDisplays().some((d) => {
        const a = d.workArea
        return saved.right > a.x + 120 && saved.right <= a.x + a.width + 1 && saved.top >= a.y - 1 && saved.top < a.y + a.height - 60
      })
      if (onScreen) return (this.anchor = saved)
    }
    const a = screen.getPrimaryDisplay().workArea
    return (this.anchor = { right: a.x + a.width - MARGIN, top: a.y + TOP_OFFSET })
  }

  /** Place the window at the anchor with the current size, kept inside the screen it is on. */
  private place() {
    const win = this.ensure()
    const { w, h } = this.expanded ? SIZE.expanded : SIZE.compact
    const anchor = this.resolveAnchor()
    const area = screen.getDisplayNearestPoint({ x: anchor.right - 1, y: anchor.top }).workArea
    const x = Math.round(Math.min(Math.max(anchor.right - w, area.x), area.x + area.width - w))
    const y = Math.round(Math.min(Math.max(anchor.top, area.y), area.y + area.height - h))
    win.setBounds({ x, y, width: w, height: h })
  }

  show() {
    const win = this.ensure()
    if (win.isVisible()) return
    this.place()
    const reveal = () => { if (!win.isDestroyed()) { win.showInactive(); win.setAlwaysOnTop(true, 'screen-saver') } }
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal)
    else reveal()
  }

  hide() {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide()
    // Next time it shows small again.
    if (this.expanded) this.setExpanded(false)
  }

  setExpanded(on: boolean) {
    this.expanded = on
    if (this.win && !this.win.isDestroyed()) {
      this.place()
      this.win.webContents.send('mini-expanded', on)
    }
  }

  dragStart() {
    if (!this.win) return
    const c = screen.getCursorScreenPoint()
    const [x, y] = this.win.getPosition()
    this.drag = { cx: c.x, cy: c.y, x, y }
  }

  dragMove() {
    if (!this.win || !this.drag) return
    const c = screen.getCursorScreenPoint()
    this.win.setPosition(Math.round(this.drag.x + c.x - this.drag.cx), Math.round(this.drag.y + c.y - this.drag.cy))
  }

  dragEnd() {
    if (!this.win || !this.drag) return
    this.drag = null
    const b = this.win.getBounds()
    this.anchor = { right: b.x + b.width, top: b.y }
    // Snap back inside the screen if it was dragged half off.
    this.place()
    this.opts.saveAnchor(this.anchor)
  }

  send(channel: string, payload: unknown) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }

  destroy() {
    this.win?.destroy()
    this.win = null
  }
}
