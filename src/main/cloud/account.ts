import { app, safeStorage, shell } from 'electron'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import type { AccountState, AdCard } from '../../shared/types'
import { HOUSE_ADS } from '../../shared/types'

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

  private loadToken(): string | null {
    try {
      const raw = fs.readFileSync(this.file)
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
    } catch {
      return null
    }
  }

  private saveToken(t: string | null) {
    this.token = t
    try {
      if (!t) fs.rmSync(this.file, { force: true })
      else fs.writeFileSync(this.file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t, 'utf8'))
    } catch { /* ignore */ }
  }

  private set(next: Partial<AccountState>) {
    this.state = { ...this.state, ...next, serverUrl: this.base() }
    this.emit('change', this.state)
  }

  async api<T>(method: string, p: string, body?: unknown): Promise<T> {
    const base = this.base()
    if (!base) throw new Error('Cloud is not set up. Add a Clutch cloud server under Settings → Account.')
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

  async refresh() {
    if (!this.base()) return this.set({ signedIn: false, error: undefined })
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

  /** Browser sign-in: the server sends the token back to a one-time loopback URL. */
  async signIn(provider: string): Promise<AccountState> {
    const base = this.base()
    if (!base) throw new Error('Cloud is not set up yet')
    const server = http.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const redirect = `http://127.0.0.1:${port}/done`
    const authUrl = `${base}/auth/${encodeURIComponent(provider)}/start?redirect=${encodeURIComponent(redirect)}`
    try {
      const token = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Sign-in timed out')), 5 * 60_000)
        server.on('request', (req, res) => {
          const u = new URL(req.url ?? '/', redirect)
          if (u.pathname !== '/done') { res.writeHead(404); res.end(); return }
          const t = u.searchParams.get('token')
          const err = u.searchParams.get('error')
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#03050b;color:#f2f7ff;font-family:Segoe UI,system-ui"><div style="text-align:center"><div style="letter-spacing:.2em;font-weight:700;color:#4fe3ff">CLUTCH</div><h2>${t ? 'You are signed in. You can close this tab.' : 'Sign-in did not finish: ' + String(err ?? 'unknown').replace(/[<>&]/g, '')}</h2></div>`)
          clearTimeout(timer)
          t ? resolve(t) : reject(new Error(err ?? 'Sign-in failed'))
        })
        this.lastAuthUrl = authUrl
        if (!process.env.CLUTCH_TEST_NO_BROWSER) void shell.openExternal(authUrl)
      })
      this.saveToken(token)
      await this.refresh()
      return this.state
    } finally {
      server.close()
    }
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
    void shell.openExternal(url)
  }

  async portal() {
    const { url } = await this.api<{ url: string }>('POST', '/api/billing/portal')
    void shell.openExternal(url)
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
