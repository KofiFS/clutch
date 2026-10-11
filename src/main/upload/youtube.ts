import { google, type youtube_v3 } from 'googleapis'
import type { Credentials } from 'google-auth-library'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'

export interface YouTubeUploadInput {
  file: string
  title: string
  description: string
  tags: string[]
  privacy: 'private' | 'unlisted' | 'public'
  onProgress?: (fraction: number) => void
}

/**
 * YouTube Data API v3 uploader. Uses the OAuth "desktop app" flow with a loopback redirect so no
 * secret ever leaves the machine. Tokens are stored in the app's data folder.
 */
export class YouTubeUploader {
  private tokenFile: string

  constructor(dataDir: string, private clientId: string, private clientSecret: string) {
    this.tokenFile = path.join(dataDir, 'youtube-token.json')
  }

  get configured() {
    return !!(this.clientId && this.clientSecret)
  }

  get connected() {
    return fs.existsSync(this.tokenFile)
  }

  disconnect() {
    try { fs.unlinkSync(this.tokenFile) } catch { /* ignore */ }
  }

  private makeClient(redirectUri?: string) {
    const client = new google.auth.OAuth2(this.clientId, this.clientSecret, redirectUri)
    client.on('tokens', (t) => this.saveTokens({ ...this.loadTokens(), ...t }))
    return client
  }

  private loadTokens(): Credentials {
    try { return JSON.parse(fs.readFileSync(this.tokenFile, 'utf8')) } catch { return {} }
  }

  private saveTokens(t: Credentials) {
    fs.writeFileSync(this.tokenFile, JSON.stringify(t, null, 2))
  }

  /** Opens the browser for consent and waits for Google to redirect back to a local port. */
  async connect(): Promise<{ channelTitle: string }> {
    if (!this.configured) throw new Error('Add your Google OAuth client ID and secret first')
    const server = http.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const redirectUri = `http://127.0.0.1:${port}/callback`
    const client = this.makeClient(redirectUri)
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly']
    })

    const code = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => { server.close(); reject(new Error('Sign-in timed out')) }, 5 * 60_000)
      server.on('request', (req, res) => {
        const u = new URL(req.url ?? '/', redirectUri)
        if (u.pathname !== '/callback') { res.statusCode = 404; res.end(); return }
        const c = u.searchParams.get('code')
        const err = u.searchParams.get('error')
        res.setHeader('Content-Type', 'text/html')
        res.end(`<html><body style="font-family:sans-serif;background:#0f1115;color:#eee;display:grid;place-items:center;height:100vh"><h2>${c ? 'ClipForge is connected to YouTube. You can close this tab.' : 'Sign-in failed: ' + err}</h2></body></html>`)
        clearTimeout(timeout)
        server.close()
        c ? resolve(c) : reject(new Error(err ?? 'No code returned'))
      })
      shell.openExternal(url)
    })

    const { tokens } = await client.getToken(code)
    this.saveTokens(tokens)
    client.setCredentials(tokens)
    const yt = google.youtube({ version: 'v3', auth: client })
    const me = await yt.channels.list({ part: ['snippet'], mine: true })
    return { channelTitle: me.data.items?.[0]?.snippet?.title ?? 'YouTube' }
  }

  async upload(input: YouTubeUploadInput): Promise<{ url: string; videoId: string }> {
    if (!this.connected) throw new Error('YouTube is not connected')
    const client = this.makeClient()
    client.setCredentials(this.loadTokens())
    const yt = google.youtube({ version: 'v3', auth: client })
    const size = fs.statSync(input.file).size
    const res = await yt.videos.insert(
      {
        part: ['snippet', 'status'],
        requestBody: {
          snippet: { title: input.title.slice(0, 100), description: input.description, tags: input.tags, categoryId: '20' },
          status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: false }
        },
        media: { body: fs.createReadStream(input.file) }
      } satisfies youtube_v3.Params$Resource$Videos$Insert,
      { onUploadProgress: (e: { bytesRead: number }) => input.onProgress?.(Math.min(1, e.bytesRead / size)) }
    )
    const videoId = res.data.id!
    return { videoId, url: `https://youtu.be/${videoId}` }
  }
}
