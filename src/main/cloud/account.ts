import { app, safeStorage } from 'electron'
import { openExternalSafe } from '../security'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import https from 'node:https'
import path from 'node:path'
import type { AccountState, AdCard } from '../../shared/types'
import { HOUSE_ADS } from '../../shared/types'

const originOf = (url: string) => { try { return new URL(url).origin } catch { return '' } }

/**
 * Clutch account: sign-in through the browser (Discord / Google / Twitch via the Clutch cloud
 * server), an encrypted session token on disk, and the cloud calls that need it.
 * The renderer never sees the token; it only gets AccountState.
 */
export class CloudAccount extends EventEmitter<{ change: [AccountState] }> {
  private token: string | null = null
  private file = path.join(app.getPath('userData'), 'account.bin')
  state: AccountState = { signedIn: false, serverUrl: '' }
  /** For automated tests: the last sign-in URL instead of opening a browser. */
  lastAuthUrl = ''

  constructor(private serverUrl: () => string) {
    super()
    this.token = this.loadToken()
    this.state = { signedIn: false, serverUrl: this.base() }
  }

  private base() {
    return this.serverUrl().trim().replace(/\/$/, '')
  }

  /**
   * The token is bound to the server that issued it: it is only ever sent to that origin, so
   * changing the server address (in Settings or by a renderer bug) can't leak it elsewhere.
   */
  private tokenOrigin = ''

  private loadToken(): string | null {
    try {
      const buf = fs.readFileSync(this.file)
      const raw = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
      if (raw.startsWith('{')) {
        const j = JSON.parse(raw) as { origin?: string; token?: string }
        this.tokenOrigin = j.origin ?? ''
        return j.token ?? null
      }
      // Older versions stored just the token; it came from the server that is set now.
      this.tokenOrigin = originOf(this.base())
      return raw
    } catch {
      return null
    }
  }

  private saveToken(t: string | null) {
    this.token = t
    this.tokenOrigin = t ? originOf(this.base()) : ''
    try {
      if (!t) fs.rmSync(this.file, { force: true })
      else {
        const raw = JSON.stringify({ origin: this.tokenOrigin, token: t })
        fs.writeFileSync(this.file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(raw) : Buffer.from(raw, 'utf8'))
      }
    } catch { /* ignore */ }
  }

  private set(next: Partial<AccountState>) {
    this.state = { ...this.state, ...next, serverUrl: this.base() }
    this.emit('change', this.state)
  }

  async api<T>(method: string, p: string, body?: unknown): Promise<T> {
    const base = this.base()
    if (!base) throw new Error('Cloud is not set up. Add a Clutch cloud server under Settings → Account.')
    this.dropForeignToken()
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    })
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    if (r.status === 401 && this.token) {
      this.saveToken(null)
      this.set({ signedIn: false, user: undefined, plan: undefined, usage: undefined, error: 'Your session ended. Sign in again.' })
    }
    if (!r.ok) throw new Error(j.error ?? `Server returned ${r.status}`)
    return j as T
  }

  /** The server address changed since sign-in: that session belongs to the old server, so forget it. */
  private dropForeignToken() {
    if (!this.token || originOf(this.base()) === this.tokenOrigin) return
    this.saveToken(null)
    this.set({ signedIn: false, user: undefined, plan: undefined, usage: undefined })
  }

  async refresh() {
    if (!this.base()) return this.set({ signedIn: false, error: undefined })
    this.dropForeignToken()
    if (!this.token) return this.set({ signedIn: false, user: undefined, plan: undefined, usage: undefined })
    try {
      const me = await this.api<Pick<AccountState, 'user' | 'plan' | 'usage' | 'billing'>>('GET', '/api/me')
      this.set({ signedIn: true, ...me, error: undefined })
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  async providers(): Promise<{ id: string; label: string }[]> {
    if (!this.base()) return []
    try {
      const r = await fetch(`${this.base()}/auth/providers`)
      return ((await r.json()) as { providers: { id: string; label: string }[] }).providers ?? []
    } catch {
      return []
    }
  }

  /**
   * A one-time loopback address for the browser to come back to. The random `n` in it is checked
   * on the way back, so a sign-in link someone else started (and sent you) can't land in this app.
   */
  private async loopback(pathname: string, start: (redirect: string) => Promise<string>, done: string): Promise<URLSearchParams> {
    const server = http.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const nonce = randomBytes(18).toString('base64url')
    const redirect = `http://127.0.0.1:${port}${pathname}?n=${nonce}`
    try {
      const authUrl = await start(redirect)
      return await new Promise<URLSearchParams>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for the browser. Try again.')), 5 * 60_000)
        server.on('request', (req, res) => {
          const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
          if (u.pathname !== pathname) { res.writeHead(404); res.end(); return }
          const ok = u.searchParams.get('n') === nonce
          const err = ok ? u.searchParams.get('error') : 'this link was not started by this Clutch app'
          const good = ok && !err
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" })
          res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#03050b;color:#f2f7ff;font-family:Segoe UI,system-ui"><div style="text-align:center"><div style="letter-spacing:.2em;font-weight:700;color:#4fe3ff">CLUTCH</div><h2>${good ? done : 'That did not finish: ' + String(err ?? 'unknown').replace(/[<>&"']/g, '')}</h2></div>`)
          if (!ok) return // keep waiting for the real one
          clearTimeout(timer)
          good ? resolve(u.searchParams) : reject(new Error(err ?? 'Cancelled'))
        })
        this.lastAuthUrl = authUrl
        if (!process.env.CLUTCH_TEST_NO_BROWSER) void openExternalSafe(authUrl).then((opened) => { if (!opened) { clearTimeout(timer); reject(new Error('The server sent an invalid link')) } })
      })
    } finally {
      server.close()
    }
  }

  /** Browser sign-in: the server sends the token back to a one-time loopback URL. */
  async signIn(provider: string): Promise<AccountState> {
    const base = this.base()
    if (!base) throw new Error('Cloud is not set up yet')
    const q = await this.loopback('/done', async (redirect) => `${base}/auth/${encodeURIComponent(provider)}/start?redirect=${encodeURIComponent(redirect)}`, 'You are signed in. You can close this tab.')
    const token = q.get('token')
    if (!token) throw new Error('Sign-in failed')
    this.saveToken(token)
    await this.refresh()
    return this.state
  }

  /** One-click YouTube: Google sends the browser back here, and this app finishes it with its own session. */
  async connectYouTube(): Promise<{ channel: string | null }> {
    const q = await this.loopback('/youtube', async (redirect) => (await this.api<{ url: string }>('POST', '/api/youtube/connect', { redirect })).url, 'Clutch is connected to YouTube. You can close this tab.')
    return this.api<{ channel: string | null }>('POST', '/api/youtube/finish', { code: q.get('code'), state: q.get('state') })
  }

  signOut() {
    this.saveToken(null)
    this.set({ signedIn: false, user: undefined, plan: undefined, usage: undefined, error: undefined })
  }

  // ---------------- cloud clips ----------------
  async uploadClip(meta: { title: string; game: string; duration: number; width: number; height: number }, videoFile: string, thumbFile: string | undefined, onProgress: (f: number) => void) {
    const size = fs.statSync(videoFile).size
    const thumbSize = thumbFile && fs.existsSync(thumbFile) ? fs.statSync(thumbFile).size : 0
    const ticket = await this.api<{ id: string; shareUrl: string; expires: number | null; video: { url: string; headers: Record<string, string> }; thumb: { url: string; headers: Record<string, string> } | null }>('POST', '/api/clips', { ...meta, size, thumbSize })
    if (ticket.thumb && thumbFile) await putFile(ticket.thumb.url, ticket.thumb.headers, thumbFile, () => undefined)
    await putFile(ticket.video.url, ticket.video.headers, videoFile, onProgress)
    const done = await this.api<{ id: string; shareUrl: string; expires: number | null }>('POST', `/api/clips/${ticket.id}/complete`)
    void this.refresh()
    return done
  }

  deleteCloud(id: string) {
    return this.api('DELETE', `/api/clips/${id}`).finally(() => void this.refresh())
  }

  async checkout() {
    const { url } = await this.api<{ url: string }>('POST', '/api/billing/checkout')
    void openExternalSafe(url)
  }

  async portal() {
    const { url } = await this.api<{ url: string }>('POST', '/api/billing/portal')
    void openExternalSafe(url)
  }

  async devPlan(plan: 'free' | 'pro') {
    await this.api('POST', '/api/dev/plan', { plan })
    await this.refresh()
  }

  // ---------------- sponsored cards ----------------
  async ads(placement: string): Promise<AdCard[]> {
    const base = this.base()
    if (base) {
      try {
        const r = await fetch(`${base}/api/ads?placement=${encodeURIComponent(placement)}&count=1`, { signal: AbortSignal.timeout(4000) })
        if (r.ok) {
          const ads = ((await r.json()) as { ads: AdCard[] }).ads ?? []
          // Only plain https links (or clutch:// in-app links) are ever opened.
          return ads.filter((a) => /^(https:\/\/|clutch:\/\/)/.test(a.url)).map((a) => ({ ...a, image: undefined }))
        }
      } catch { /* offline: fall through */ }
    }
    const pool = HOUSE_ADS.filter((a) => a.placements.includes(placement))
    return pool.length ? [pool[Math.floor(Math.random() * pool.length)]] : []
  }

  adClick(id: string) {
    const base = this.base()
    if (base) void fetch(`${base}/api/ads/${encodeURIComponent(id)}/click`, { method: 'POST' }).catch(() => undefined)
  }
}

/** PUT a file with upload progress (fetch has no upload progress in Node). */
function putFile(url: string, headers: Record<string, string>, file: string, onProgress: (f: number) => void): Promise<void> {
  const size = fs.statSync(file).size
  const u = new URL(url)
  const mod = u.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = mod.request(u, { method: 'PUT', headers: { ...headers, 'Content-Length': String(size) } }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => (res.statusCode && res.statusCode < 300 ? resolve() : reject(new Error(`Upload failed (${res.statusCode}) ${body.slice(0, 200)}`))))
    })
    req.on('error', reject)
    let sent = 0
    const stream = fs.createReadStream(file)
    stream.on('data', (c) => { sent += c.length; onProgress(sent / size) })
    stream.on('error', reject)
    stream.pipe(req)
  })
}
