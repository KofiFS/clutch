import { config } from './config.mjs'
import { sign, verify } from './jwt.mjs'
import { users } from './db.mjs'

/**
 * Sign-in with Discord, Google (also used for YouTube) or Twitch using the authorization-code flow.
 * The client secrets stay on this server; the desktop app only ever gets a Clutch session token,
 * delivered to a loopback URL (http://127.0.0.1:<port>/...) that the app is listening on.
 */
const PROVIDERS = {
  discord: {
    label: 'Discord',
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    async profile(accessToken) {
      const r = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!r.ok) throw new Error(`Discord profile ${r.status}`)
      const u = await r.json()
      return { providerId: u.id, name: u.global_name || u.username, email: u.email, avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null }
    }
  },
  google: {
    label: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    extra: { prompt: 'select_account' },
    async profile(accessToken) {
      const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!r.ok) throw new Error(`Google profile ${r.status}`)
      const u = await r.json()
      return { providerId: u.sub, name: u.name || u.email, email: u.email, avatar: u.picture }
    }
  },
  twitch: {
    label: 'Twitch',
    authorize: 'https://id.twitch.tv/oauth2/authorize',
    token: 'https://id.twitch.tv/oauth2/token',
    scope: 'user:read:email',
    async profile(accessToken) {
      const r = await fetch('https://api.twitch.tv/helix/users', { headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': config.providers.twitch.id } })
      if (!r.ok) throw new Error(`Twitch profile ${r.status}`)
      const u = (await r.json()).data?.[0]
      return { providerId: u.id, name: u.display_name || u.login, email: u.email, avatar: u.profile_image_url }
    }
  }
}

export function enabledProviders() {
  const list = Object.entries(PROVIDERS).filter(([k]) => config.providers[k]?.id && config.providers[k]?.secret).map(([id, p]) => ({ id, label: p.label }))
  if (config.devLogin) list.push({ id: 'dev', label: 'Test login (dev)' })
  return list
}

/** Only loopback redirects are accepted: tokens must never be sent to another site. */
export function safeRedirect(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname) || !u.port) return null
    return u.toString()
  } catch {
    return null
  }
}

const callbackUrl = (provider) => `${config.publicUrl}/auth/${provider}/callback`

export function startUrl(provider, redirect) {
  const state = sign({ redirect, provider }, { kind: 'state', ttlSeconds: 600 })
  if (provider === 'dev') return `${config.publicUrl}/auth/dev/form?state=${encodeURIComponent(state)}`
  const p = PROVIDERS[provider]
  const q = new URLSearchParams({ client_id: config.providers[provider].id, redirect_uri: callbackUrl(provider), response_type: 'code', scope: p.scope, state, ...(p.extra ?? {}) })
  return `${p.authorize}?${q}`
}

export function readState(state, provider) {
  const s = verify(state, 'state')
  return s && s.provider === provider ? s : null
}

export async function finish(provider, code) {
  const p = PROVIDERS[provider]
  const body = new URLSearchParams({ client_id: config.providers[provider].id, client_secret: config.providers[provider].secret, grant_type: 'authorization_code', code, redirect_uri: callbackUrl(provider) })
  const r = await fetch(p.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body })
  if (!r.ok) throw new Error(`${p.label} sign-in failed (${r.status})`)
  const { access_token } = await r.json()
  const prof = await p.profile(access_token)
  return users.upsert({ provider, ...prof })
}

export const sessionToken = (user) => sign({ sub: user.id }, { kind: 'session', ttlSeconds: 60 * 86400 })
export const isProvider = (p) => p === 'dev' ? config.devLogin : !!PROVIDERS[p] && !!config.providers[p]?.id
