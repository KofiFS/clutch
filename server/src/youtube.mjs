import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from './config.mjs'
import { db } from './db.mjs'
import { sign, verify } from './jwt.mjs'

/**
 * One-click YouTube for Clutch accounts. The server holds the Google OAuth client (the same one
 * used for "Sign in with Google", with the YouTube upload scope added and verified by Google) and
 * keeps each user's refresh token, encrypted. The app asks for a short-lived access token and
 * uploads straight to YouTube, so video never passes through this server.
 *
 * Google console: add `${PUBLIC_URL}/auth/youtube/callback` as an authorized redirect URI.
 * Quota: every upload costs 1,600 units of the project's daily YouTube quota (10,000 by default,
 * about 6 uploads a day for everyone) until Google approves a quota increase.
 */
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'
const callbackUrl = () => `${config.publicUrl}/auth/youtube/callback`

db.exec(`CREATE TABLE IF NOT EXISTS youtube_links (
  user_id TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  channel TEXT,
  created INTEGER NOT NULL
)`)

// Refresh tokens are encrypted with a key derived from JWT_SECRET (AES-256-GCM).
const key = () => createHash('sha256').update(`yt:${config.jwtSecret}`).digest()
function seal(text) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')
}
function open(b64) {
  const raw = Buffer.from(b64, 'base64')
  const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12))
  d.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
}

export const youtubeEnabled = () => !!(config.providers.google.id && config.providers.google.secret)

export function youtubeStatus(userId) {
  const row = db.prepare('SELECT channel FROM youtube_links WHERE user_id = ?').get(userId)
  return { enabled: youtubeEnabled(), connected: !!row, channel: row?.channel ?? null }
}

export function youtubeConnectUrl(userId) {
  const state = sign({ sub: userId }, { kind: 'yt', ttlSeconds: 600 })
  const q = new URLSearchParams({
    client_id: config.providers.google.id,
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.providers.google.id, client_secret: config.providers.google.secret, ...params })
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error_description || j.error || `Google returned ${r.status}`)
  return j
}

/** OAuth callback: store the refresh token for the user named in the signed state. */
export async function youtubeFinish(code, state) {
  const s = verify(state, 'yt')
  if (!s) throw new Error('This link expired. Start connecting again from Clutch.')
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl() })
  if (!t.refresh_token) throw new Error('Google did not grant offline access. Try again.')
  let channel = null
  try {
    const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${t.access_token}` } })
    channel = (await r.json()).items?.[0]?.snippet?.title ?? null
  } catch { /* name is optional */ }
  db.prepare('INSERT INTO youtube_links (user_id, refresh_token, channel, created) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET refresh_token = excluded.refresh_token, channel = excluded.channel')
    .run(s.sub, seal(t.refresh_token), channel, Date.now())
  return { channel }
}

/** A fresh access token (about an hour) for the app to upload with. */
export async function youtubeAccessToken(userId) {
  const row = db.prepare('SELECT refresh_token FROM youtube_links WHERE user_id = ?').get(userId)
  if (!row) return null
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: open(row.refresh_token) })
    return { accessToken: t.access_token, expiresIn: t.expires_in ?? 3600 }
  } catch (e) {
    // Revoked on Google's side: forget it so the app shows "Connect" again.
    if (/invalid_grant/i.test(String(e?.message))) db.prepare('DELETE FROM youtube_links WHERE user_id = ?').run(userId)
    throw e
  }
}

export async function youtubeDisconnect(userId) {
  const row = db.prepare('SELECT refresh_token FROM youtube_links WHERE user_id = ?').get(userId)
  if (row) {
    try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(open(row.refresh_token))}`, { method: 'POST' }) } catch { /* best effort */ }
    db.prepare('DELETE FROM youtube_links WHERE user_id = ?').run(userId)
  }
}
