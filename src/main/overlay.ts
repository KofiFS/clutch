import { BrowserWindow, screen, type Rectangle } from 'electron'

/**
 * A tiny click-through, always-on-top window that flashes "Clipped!" in the corner of the game.
 * Works over borderless/windowed games; exclusive-fullscreen games draw over it (same as Medal).
 */
export class OverlayToast {
  private win: BrowserWindow | null = null
  private hideTimer: NodeJS.Timeout | null = null
  /** Something already in the top-right corner (the recording widget); the toast goes under it. */
  avoid: () => Rectangle | null = () => null

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const w = new BrowserWindow({
      width: 320,
      height: 84,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      hasShadow: false,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true }
    })
    w.setIgnoreMouseEvents(true)
    // Shown on screen, never in the recording.
    w.setContentProtection(true)
    w.setAlwaysOnTop(true, 'screen-saver')
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    void w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML))
    this.win = w
    return w
  }

  show(title: string, subtitle: string, kind: 'clip' | 'info' | 'error' = 'clip', ms = 2600) {
    const w = this.ensure()
    const d = screen.getPrimaryDisplay()
    const { x, y, width } = d.workArea
    const busy = this.avoid()
    if (busy) w.setPosition(Math.round(busy.x + busy.width - 320), Math.round(busy.y + busy.height - 4))
    else w.setPosition(x + width - 320 - 24, y + 24)
    const payload = JSON.stringify({ title, subtitle, kind })
    const run = () => {
      w.webContents.executeJavaScript(`window.showToast(${payload})`).catch(() => undefined)
      w.showInactive()
    }
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', run)
    else run()
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => {
      w.webContents.executeJavaScript('window.hideToast()').catch(() => undefined)
      setTimeout(() => { if (!w.isDestroyed()) w.hide() }, 260)
    }, ms)
  }

  destroy() {
    this.win?.destroy()
    this.win = null
  }
}

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent;overflow:hidden;font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif}
  .t{position:absolute;inset:8px;display:flex;align-items:center;gap:14px;padding:0 18px;border-radius:14px;
     background:rgba(14,16,24,.92);border:1px solid rgba(255,255,255,.08);box-shadow:0 12px 40px rgba(0,0,0,.5);
     color:#f1f3f8;opacity:0;transform:translateY(-10px) scale(.98);transition:opacity .2s ease-out,transform .22s cubic-bezier(.2,.9,.3,1.2)}
  .t.on{opacity:1;transform:none}
  .i{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;flex:none;background:linear-gradient(135deg,#7c5cff,#22d3ee)}
  .i.error{background:linear-gradient(135deg,#f87171,#fb923c)} .i.info{background:linear-gradient(135deg,#475569,#64748b)}
  .i svg{width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  .x{min-width:0}.h{font-weight:700;font-size:15px;letter-spacing:.2px}.s{font-size:12px;color:#a3abbd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar{position:absolute;left:18px;right:18px;bottom:7px;height:2px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden}
  .bar i{display:block;height:100%;background:linear-gradient(90deg,#7c5cff,#22d3ee);transform-origin:left;animation:shrink 2.6s linear forwards}
  @keyframes shrink{from{transform:scaleX(1)}to{transform:scaleX(0)}}
</style></head><body>
<div class="t" id="t"><div class="i" id="i"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></div><div class="x"><div class="h" id="h"></div><div class="s" id="s"></div></div><div class="bar"><i id="b"></i></div></div>
<script>
  window.showToast=function(p){var t=document.getElementById('t');document.getElementById('h').textContent=p.title;document.getElementById('s').textContent=p.subtitle;
    document.getElementById('i').className='i '+p.kind;var b=document.getElementById('b');b.style.animation='none';void b.offsetWidth;b.style.animation='';
    t.classList.remove('on');void t.offsetWidth;t.classList.add('on')};
  window.hideToast=function(){document.getElementById('t').classList.remove('on')};
</script></body></html>`
