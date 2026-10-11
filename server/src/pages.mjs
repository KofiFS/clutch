import { config } from './config.mjs'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const shell = (title, body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${head}
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#f2f7ff;
    background:radial-gradient(80% 60% at 15% 0%,rgba(40,130,255,.35),transparent 60%),radial-gradient(70% 60% at 100% 30%,rgba(0,215,205,.22),transparent 60%),#03050b}
  main{max-width:1100px;margin:0 auto;padding:28px 16px}
  .card{border-radius:22px;border:1px solid rgba(170,225,255,.16);background:linear-gradient(160deg,rgba(255,255,255,.08),rgba(255,255,255,.02));backdrop-filter:blur(20px);box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 30px 80px -30px #000}
  video{width:100%;max-height:72vh;border-radius:16px;background:#000;display:block}
  h1{font-size:22px;margin:16px 4px 4px}
  .meta{color:#9fb0c8;font-size:14px;margin:0 4px}
  a.btn{display:inline-flex;align-items:center;gap:8px;margin-top:18px;padding:10px 18px;border-radius:999px;color:#00121a;font-weight:600;text-decoration:none;background:linear-gradient(180deg,#8ff1ff,#4fe3ff 45%,#2bb8ff)}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.2em;font-size:13px;margin-bottom:18px;color:#cfe9ff}
  input,button{font:inherit}
  .center{display:grid;place-items:center;min-height:80vh;text-align:center}
</style></head><body>${body}</body></html>`

/** Public watch page for a share link. Open Graph video tags make Discord/Twitter show a player. */
export function sharePage(c) {
  const url = `${config.publicUrl}/s/${c.share_id}`
  const video = `${config.publicUrl}/media/${c.share_id}/video.mp4`
  const thumb = c.thumb_key ? `${config.publicUrl}/media/${c.share_id}/thumb.jpg` : ''
  const title = `${c.title}${c.game ? ` · ${c.game}` : ''}`
  const head = `
<meta property="og:site_name" content="Clutch"><meta property="og:type" content="video.other"><meta property="og:title" content="${esc(title)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:video" content="${esc(video)}"><meta property="og:video:secure_url" content="${esc(video)}">
<meta property="og:video:type" content="video/mp4">${c.width ? `<meta property="og:video:width" content="${c.width}"><meta property="og:video:height" content="${c.height}">` : ''}
${thumb ? `<meta property="og:image" content="${esc(thumb)}">` : ''}<meta name="twitter:card" content="player"><meta name="theme-color" content="#4fe3ff">`
  return shell(title, `<main>
  <div class="brand">CLUTCH</div>
  <div class="card" style="padding:14px">
    <video src="${esc(video)}" ${thumb ? `poster="${esc(thumb)}"` : ''} controls autoplay playsinline></video>
    <h1>${esc(c.title)}</h1>
    <p class="meta">${esc(c.game ?? '')}${c.game ? ' · ' : ''}${esc(c.user_name)} · ${c.views + 1} view${c.views ? 's' : ''}</p>
  </div>
  <a class="btn" href="https://github.com/">Clip your own moments with Clutch</a>
</main>`, head)
}

export function messagePage(title, text) {
  return shell(title, `<main class="center"><div><div class="brand" style="justify-content:center">CLUTCH</div><h1>${esc(title)}</h1><p class="meta">${esc(text)}</p></div></main>`)
}

/** Dev-only "provider": type a name to get a test account. */
export function devLoginPage(state) {
  return shell('Test login', `<main class="center"><form class="card" method="post" action="/auth/dev/callback" style="padding:28px;min-width:320px">
    <div class="brand" style="justify-content:center">CLUTCH · TEST LOGIN</div>
    <input type="hidden" name="state" value="${esc(state)}">
    <input name="name" placeholder="Your name" required style="width:100%;box-sizing:border-box;padding:10px 14px;border-radius:12px;border:1px solid #2a3a55;background:#0a1222;color:#fff">
    <button style="margin-top:14px;width:100%;padding:10px;border:0;border-radius:999px;font-weight:600;background:#4fe3ff;color:#00121a">Sign in</button>
    <p class="meta" style="margin-top:12px">Only enabled when DEV_LOGIN=1.</p></form></main>`)
}
