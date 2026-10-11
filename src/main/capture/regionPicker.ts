import { BrowserWindow, screen } from 'electron'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Full-screen, click-to-drag area picker on one monitor (like OBS / Snipping Tool).
 * Resolves with the rectangle in the monitor's physical pixels, or null on Esc.
 */
export async function pickRegion(monitorIndex: number): Promise<Rect | null> {
  const displays = screen.getAllDisplays()
  const d = displays[Math.min(monitorIndex, displays.length - 1)] ?? screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(true)
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML))
  win.show()
  win.focus()
  try {
    const r = (await win.webContents.executeJavaScript('window.__pick', true)) as { x: number; y: number; w: number; h: number } | null
    if (!r) return null
    const sf = d.scaleFactor
    // Even sizes keep the video encoders happy.
    const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)
    return { x: even(r.x * sf), y: even(r.y * sf), w: even(r.w * sf), h: even(r.h * sf) }
  } catch {
    return null
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;overflow:hidden;cursor:crosshair;font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif;user-select:none}
  #dim{position:fixed;inset:0;background:rgba(2,6,16,.55)}
  #sel{position:fixed;display:none;border:2px solid #4fe3ff;box-shadow:0 0 0 9999px rgba(2,6,16,.55),0 0 24px rgba(79,227,255,.7);border-radius:6px;background:transparent}
  #size{position:fixed;display:none;padding:4px 10px;border-radius:999px;background:rgba(8,14,28,.92);color:#f2f7ff;font-size:12px;border:1px solid rgba(255,255,255,.15)}
  #help{position:fixed;top:28px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:999px;background:rgba(8,14,28,.9);color:#f2f7ff;font-size:14px;border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 40px rgba(0,0,0,.6)}
  #help b{color:#4fe3ff;font-weight:600}
</style></head><body>
<div id="dim"></div><div id="sel"></div><div id="size"></div>
<div id="help">Drag to choose what to record &nbsp;·&nbsp; <b>Enter</b> whole screen &nbsp;·&nbsp; <b>Esc</b> cancel</div>
<script>
  var start=null, sel=document.getElementById('sel'), dim=document.getElementById('dim'), size=document.getElementById('size'), help=document.getElementById('help');
  var done; window.__pick=new Promise(function(r){done=r});
  function rect(e){var x=Math.min(start.x,e.clientX),y=Math.min(start.y,e.clientY);return{x:x,y:y,w:Math.abs(e.clientX-start.x),h:Math.abs(e.clientY-start.y)}}
  addEventListener('mousedown',function(e){start={x:e.clientX,y:e.clientY};help.style.display='none'});
  addEventListener('mousemove',function(e){if(!start)return;var r=rect(e);dim.style.display='none';sel.style.display='block';
    sel.style.left=r.x+'px';sel.style.top=r.y+'px';sel.style.width=r.w+'px';sel.style.height=r.h+'px';
    size.style.display='block';size.textContent=Math.round(r.w*devicePixelRatio)+' x '+Math.round(r.h*devicePixelRatio);
    size.style.left=(r.x+r.w/2-size.offsetWidth/2)+'px';size.style.top=(r.y+r.h+10>innerHeight-30?r.y-34:r.y+r.h+10)+'px'});
  addEventListener('mouseup',function(e){if(!start)return;var r=rect(e);start=null;if(r.w<40||r.h<40){dim.style.display='block';sel.style.display='none';size.style.display='none';help.style.display='block';return}done(r)});
  addEventListener('keydown',function(e){if(e.key==='Escape')done(null);if(e.key==='Enter')done({x:0,y:0,w:innerWidth,h:innerHeight})});
</script></body></html>`
