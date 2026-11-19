import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { config } from './config.mjs'
import { adStats, clips, users } from './db.mjs'
import { verify } from './jwt.mjs'
import { enabledProviders, finish, isProvider, readState, safeRedirect, sessionToken, startUrl } from './oauth.mjs'
import { PLANS, planOf } from './plans.mjs'
import { storage } from './storage.mjs'
import { billingEnabled, checkoutUrl, handleEvent, portalUrl, verifyWebhook } from './billing.mjs'
import { devLoginPage, messagePage, sharePage } from './pages.mjs'
import { users as usersDb } from './db.mjs'
import { smartRead, smartReadEnabled, takeSmartRead } from './importer.mjs'
import { judgeFrames, takeVisionCheck, visionEnabled } from './vision.mjs'
import { youtubeAccessToken, youtubeConnectUrl, youtubeDisconnect, youtubeEnabled, youtubeFinish, youtubeStatus } from './youtube.mjs'
import { counters } from './db.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const adsFile = path.resolve(here, '..', 'ads.json')

// ---------------- helpers ----------------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status } }
const send = (res, status, body, headers = {}) => {
  const isStr = typeof body === 'string'
  res.writeHead(status, { 'Content-Type': isStr ? 'text/html; charset=utf-8' : 'application/json', 'X-Content-Type-Options': 'nosniff', ...headers })
  res.end(isStr ? body : JSON.stringify(body))
}
const redirect = (res, to) => { res.writeHead(302, { Location: to }); res.end() }
const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')

// Ad counters are public, so each address counts once per card per day (clicks) and a few times per hour (views).
const adSeen = new Map()
function countAd(req, id, kind) {
  const ip = req.socket.remoteAddress ?? ''
  const now = Date.now()
  const key = `${kind}|${ip}|${id}`
  const prev = adSeen.get(key)
  const windowMs = kind === 'click' ? 86_400_000 : 3_600_000
  const cap = kind === 'click' ? 1 : 6
  const entry = prev && prev.until > now ? prev : { until: now + windowMs, n: 0 }
  if (entry.n >= cap) return
  entry.n++
  adSeen.set(key, entry)
  if (adSeen.size > 200_000) for (const [k, v] of adSeen) if (v.until <= now) adSeen.delete(k)
  adStats.bump(id, kind)
}
async function readBody(req, limit = 64 * 1024) {
  const chunks = []
  let n = 0
  for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, 'Body too large'); chunks.push(c) }
  return Buffer.concat(chunks).toString('utf8')
}
const json = async (req) => { try { return JSON.parse((await readBody(req)) || '{}') } catch { throw new HttpError(400, 'Invalid JSON') } }
function authed(req) {
  const t = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const s = verify(t, 'session')
  const user = s && users.get(s.sub)
  if (!user) throw new HttpError(401, 'Sign in again')
  return user
}
const shareUrl = (c) => `${config.publicUrl}/s/${c.share_id}`
const publicClip = (c) => ({ id: c.id, title: c.title, game: c.game, duration: c.duration, size: c.size, created: c.created, expires: c.expires, views: c.views, shareUrl: shareUrl(c) })
const me = (u) => {
  const plan = planOf(u)
  return {
    user: { id: u.id, name: u.name, avatar: u.avatar, provider: u.provider, email: u.email },
    plan: { id: plan.id, name: plan.name, until: u.plan_until ?? null, storageBytes: plan.storageBytes, maxClipBytes: plan.maxClipBytes, linkDays: plan.linkDays, features: plan.features },
    usage: { bytes: clips.usedBytes(u.id) },
    billing: { enabled: billingEnabled(), hasSubscription: !!u.stripe_subscription }
  }
}

/** Clips under this size are refused: no real video is this small, and tiny clips were a way around the quota. */
const MIN_CLIP_BYTES = 10 * 1024
const MAX_THUMB_BYTES = 2 * 1024 ** 2

function loadAds() {
  try { return JSON.parse(fs.readFileSync(adsFile, 'utf8')).ads ?? [] } catch { return [] }
}
function pickAds(placement, count) {
  const pool = loadAds().filter((a) => !placement || (a.placements ?? []).includes(placement))
  const out = []
  while (pool.length && out.length < count) {
    const total = pool.reduce((n, a) => n + (a.weight ?? 1), 0)
    let r = Math.random() * total
    const i = pool.findIndex((a) => (r -= a.weight ?? 1) <= 0)
    out.push(pool.splice(Math.max(0, i), 1)[0])
  }
  return out.map(({ id, title, body, cta, url, image, sponsor }) => ({ id, title, body, cta, url, image, sponsor }))
}

// ---------------- routes ----------------
async function route(req, res) {
  const url = new URL(req.url, config.publicUrl)
  const p = url.pathname
  const m = (re) => re.exec(p)
  let r

  if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true })

  // --- sign-in ---
  if (req.method === 'GET' && p === '/auth/providers') return send(res, 200, { providers: enabledProviders() })
  if (req.method === 'GET' && (r = m(/^\/auth\/(\w+)\/start$/))) {
    const provider = r[1]
    const back = safeRedirect(url.searchParams.get('redirect') ?? '')
    if (!isProvider(provider)) return send(res, 404, messagePage('Not available', `${provider} sign-in is not set up on this server.`))
    if (!back) return send(res, 400, messagePage('Bad request', 'Sign-in can only return to the Clutch app on this computer.'))
    return redirect(res, startUrl(provider, back))
  }
  if (config.devLogin && (p.startsWith('/auth/dev/') || p === '/api/dev/plan') && !isLoopback(req)) throw new HttpError(404, 'Not found')
  if (req.method === 'GET' && p === '/auth/dev/form' && config.devLogin) return send(res, 200, devLoginPage(url.searchParams.get('state') ?? ''))
  if (req.method === 'POST' && p === '/auth/dev/callback' && config.devLogin) {
    const form = new URLSearchParams(await readBody(req))
    const st = readState(form.get('state'), 'dev')
    if (!st) return send(res, 400, messagePage('Expired', 'That sign-in link expired. Try again from the app.'))
    const name = (form.get('name') ?? 'Tester').trim().slice(0, 40) || 'Tester'
    const user = users.upsert({ provider: 'dev', providerId: name.toLowerCase(), name })
    return redirect(res, `${st.redirect}${st.redirect.includes('?') ? '&' : '?'}token=${encodeURIComponent(sessionToken(user))}`)
  }
  if (req.method === 'GET' && (r = m(/^\/auth\/(\w+)\/callback$/))) {
    const provider = r[1]
    const st = readState(url.searchParams.get('state'), provider)
    if (!st) return send(res, 400, messagePage('Expired', 'That sign-in link expired. Try again from the app.'))
    const sep = st.redirect.includes('?') ? '&' : '?'
    if (url.searchParams.get('error')) return redirect(res, `${st.redirect}${sep}error=${encodeURIComponent(url.searchParams.get('error'))}`)
    try {
      const user = await finish(provider, url.searchParams.get('code') ?? '')
      return redirect(res, `${st.redirect}${sep}token=${encodeURIComponent(sessionToken(user))}`)
    } catch (e) {
      return redirect(res, `${st.redirect}${sep}error=${encodeURIComponent(e.message)}`)
    }
  }

  // --- account ---
  if (req.method === 'GET' && p === '/api/me') return send(res, 200, me(authed(req)))
  if (req.method === 'GET' && p === '/api/plans') return send(res, 200, { plans: PLANS, billing: billingEnabled() })

  // --- cloud clips ---
  if (req.method === 'POST' && p === '/api/clips') {
    const user = authed(req)
    const plan = planOf(user)
    const b = await json(req)
    const size = Number(b.size)
    if (!Number.isFinite(size) || size < MIN_CLIP_BYTES) throw new HttpError(400, 'size required')
    const thumbSize = Math.min(Math.max(0, Math.floor(Number(b.thumbSize) || 0)), MAX_THUMB_BYTES)
    if (size > plan.maxClipBytes) throw new HttpError(413, `Clips can be up to ${Math.round(plan.maxClipBytes / 1024 ** 2)} MB on ${plan.name}.`)
    if (clips.usedBytes(user.id) + size + thumbSize > plan.storageBytes) throw new HttpError(507, `Your ${Math.round(plan.storageBytes / 1024 ** 3)} GB of cloud space is full. Delete some cloud clips${plan.id === 'free' ? ' or upgrade to Pro' : ''}.`)
    const id = randomUUID()
    const c = clips.create({
      id, userId: user.id, shareId: randomBytes(6).toString('base64url'),
      title: String(b.title ?? 'Clip').slice(0, 120), game: b.game ? String(b.game).slice(0, 80) : null,
      duration: Number(b.duration) || null, width: Number(b.width) || null, height: Number(b.height) || null,
      size: Math.floor(size) + thumbSize, videoKey: `${user.id}/${id}.mp4`, thumbKey: thumbSize ? `${user.id}/${id}.jpg` : null,
      expires: plan.linkDays ? Date.now() + plan.linkDays * 86400_000 : null
    })
    return send(res, 200, {
      id,
      shareUrl: shareUrl(c),
      expires: c.expires,
      // The upload must be exactly the size declared here (signed into the link).
      video: storage.uploadUrl(c.video_key, 'video/mp4', Math.floor(size), id),
      thumb: c.thumb_key ? storage.uploadUrl(c.thumb_key, 'image/jpeg', thumbSize, id) : null
    })
  }
  if (req.method === 'PUT' && (r = m(/^\/upload\/(.+)$/)) && config.storage !== 's3') {
    const t = verify(decodeURIComponent(r[1]), 'upload')
    if (!t) throw new HttpError(403, 'Upload link expired')
    // A link only works while its clip is still waiting for its upload (not after complete or delete).
    if (!t.clip || !clips.isPending(t.clip)) throw new HttpError(403, 'Upload link already used')
    const n = await storage.writeLocal(t.key, req, t.max, () => clips.isPending(t.clip))
    return send(res, 200, { ok: true, bytes: n })
  }
  if (req.method === 'POST' && (r = m(/^\/api\/clips\/([\w-]+)\/complete$/))) {
    const user = authed(req)
    const c = clips.get(r[1])
    if (!c || c.user_id !== user.id) throw new HttpError(404, 'Not found')
    if (c.status !== 'pending') throw new HttpError(409, 'Already finished')
    const size = await storage.size(c.video_key)
    if (size <= 0) throw new HttpError(409, 'Upload not finished')
    const thumb = c.thumb_key ? Math.max(0, await storage.size(c.thumb_key)) : 0
    // Check what actually arrived, not what the app said it would send.
    const plan = planOf(user)
    const others = clips.usedBytes(user.id) - c.size
    if (size + thumb > c.size || size < MIN_CLIP_BYTES || size > plan.maxClipBytes || thumb > MAX_THUMB_BYTES || others + size + thumb > plan.storageBytes) {
      await storage.remove(c.video_key)
      await storage.remove(c.thumb_key)
      clips.remove(c.id)
      throw new HttpError(413, 'The upload was bigger than announced or than your cloud space allows.')
    }
    clips.ready(c.id, size + thumb)
    return send(res, 200, publicClip(clips.get(c.id)))
  }
  if (req.method === 'GET' && p === '/api/clips') return send(res, 200, { clips: clips.list(authed(req).id).map(publicClip) })
  if (req.method === 'DELETE' && (r = m(/^\/api\/clips\/([\w-]+)$/))) {
    const user = authed(req)
    const c = clips.get(r[1])
    if (!c || c.user_id !== user.id) throw new HttpError(404, 'Not found')
    await storage.remove(c.video_key)
    await storage.remove(c.thumb_key)
    clips.remove(c.id)
    return send(res, 200, { ok: true })
  }

  // --- public share pages ---
  if (req.method === 'GET' && (r = m(/^\/s\/([\w-]+)$/))) {
    const c = clips.byShare(r[1])
    if (!c) return send(res, 404, messagePage('Clip not found', 'This link was deleted or has expired.'))
    clips.view(c.id)
    return send(res, 200, sharePage(c))
  }
  if (req.method === 'GET' && (r = m(/^\/media\/([\w-]+)\/(video\.mp4|thumb\.jpg)$/))) {
    const c = clips.byShare(r[1])
    if (!c) return send(res, 404, { error: 'not found' })
    const key = r[2] === 'video.mp4' ? c.video_key : c.thumb_key
    if (!key) return send(res, 404, { error: 'not found' })
    return storage.serve(key, req, res, r[2] === 'video.mp4' ? 'video/mp4' : 'image/jpeg')
  }

  // --- billing ---
  if (req.method === 'POST' && p === '/api/billing/checkout') {
    if (!billingEnabled()) throw new HttpError(503, 'Subscriptions are not set up on this server yet.')
    return send(res, 200, { url: await checkoutUrl(authed(req)) })
  }
  if (req.method === 'POST' && p === '/api/billing/portal') return send(res, 200, { url: await portalUrl(authed(req)) })
  if (req.method === 'GET' && p === '/billing/done') return send(res, 200, messagePage(url.searchParams.get('ok') === '1' ? 'Thanks for supporting Clutch!' : 'No changes made', 'You can close this tab and go back to the app.'))
  if (req.method === 'POST' && p === '/webhooks/stripe') {
    const raw = await readBody(req, 1024 * 1024)
    if (!verifyWebhook(raw, req.headers['stripe-signature'])) throw new HttpError(400, 'Bad signature')
    return send(res, 200, { result: handleEvent(JSON.parse(raw)) })
  }
  if (req.method === 'POST' && p === '/api/dev/plan' && config.devLogin) {
    const user = authed(req)
    const b = await json(req)
    usersDb.setPlan(user.id, b.plan === 'pro' ? 'pro' : 'free')
    return send(res, 200, me(users.get(user.id)))
  }

  // --- settings import: smart read of screenshots (the app reads them offline first) ---
  if (req.method === 'POST' && p === '/api/import/read') {
    const user = authed(req)
    if (!smartReadEnabled()) throw new HttpError(503, 'Smart read is not set up on this server.')
    // Taken before reading the body, so parallel requests can't all pass the check.
    const slot = takeSmartRead(user.id, planOf(user).features.smartReadsPerDay ?? 3)
    if (!slot) throw new HttpError(429, "You have used all of today's smart reads. Try again tomorrow.")
    let images
    try {
      let body
      try { body = JSON.parse(await readBody(req, 12 * 1024 * 1024)) } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'Invalid JSON') }
      images = Array.isArray(body.images) ? body.images.slice(0, 4) : []
      if (!images.length || !images.every((i) => i && ['image/jpeg', 'image/png', 'image/webp'].includes(i.media_type) && typeof i.data === 'string' && i.data.length < 5_000_000)) throw new HttpError(400, 'Send 1 to 4 JPEG or PNG screenshots')
    } catch (e) { slot.release(); throw e }
    try {
      return send(res, 200, { settings: await smartRead(images), left: slot.left })
    } catch (e) {
      console.error('[smart-read]', e?.message ?? e)
      throw new HttpError(502, 'The smart read failed. Try again in a minute.')
    }
  }

  // --- YouTube through the Clutch account (no Google Cloud project per user) ---
  if (req.method === 'GET' && p === '/api/youtube') return send(res, 200, youtubeStatus(authed(req).id))
  if (req.method === 'POST' && p === '/api/youtube/connect') {
    const user = authed(req)
    if (!youtubeEnabled()) throw new HttpError(503, 'YouTube is not set up on this server yet.')
    const b = await json(req)
    const back = safeRedirect(String(b.redirect ?? ''))
    if (!back) throw new HttpError(400, 'Update Clutch to connect YouTube.')
    return send(res, 200, { url: youtubeConnectUrl(user.id, back) })
  }
  // Google sends the browser here; it is passed on to the Clutch app that started the connection,
  // which finishes it with its own session (so a link someone else started can't take your channel).
  if (req.method === 'GET' && p === '/auth/youtube/callback') {
    const st = verify(url.searchParams.get('state') ?? '', 'yt')
    if (!st?.redirect || !safeRedirect(st.redirect)) return send(res, 400, messagePage('YouTube not connected', 'This link expired. Start connecting again from Clutch.'))
    const q = new URLSearchParams()
    for (const k of ['code', 'state', 'error']) { const v = url.searchParams.get(k); if (v) q.set(k, v) }
    return redirect(res, `${st.redirect}${st.redirect.includes('?') ? '&' : '?'}${q}`)
  }
  if (req.method === 'POST' && p === '/api/youtube/finish') {
    const user = authed(req)
    const b = await json(req)
    try {
      return send(res, 200, await youtubeFinish(String(b.code ?? ''), String(b.state ?? ''), user.id))
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e))
    }
  }
  if (req.method === 'POST' && p === '/api/youtube/token') {
    const t = await youtubeAccessToken(authed(req).id).catch((e) => { throw new HttpError(409, `Reconnect YouTube: ${e.message}`) })
    if (!t) throw new HttpError(404, 'YouTube is not connected')
    return send(res, 200, t, { 'Cache-Control': 'no-store' })
  }
  if (req.method === 'POST' && p === '/api/youtube/disconnect') {
    await youtubeDisconnect(authed(req).id)
    return send(res, 200, { ok: true })
  }

  // --- screen watching for accounts without their own AI key (the app gates and rate-limits first) ---
  if (req.method === 'POST' && p === '/api/vision/judge') {
    const user = authed(req)
    if (!visionEnabled()) throw new HttpError(503, 'Screen watching is not set up on this server.')
    const slot = takeVisionCheck(user.id, planOf(user).features.visionChecksPerDay ?? 60)
    if (!slot) throw new HttpError(429, "You have used today's screen checks. They reset tomorrow, or go Pro for more.")
    let body
    try {
      try { body = JSON.parse(await readBody(req, 4 * 1024 * 1024)) } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'Invalid JSON') }
      if (typeof body.prev !== 'string' || typeof body.frame !== 'string' || body.prev.length > 1_500_000 || body.frame.length > 1_500_000) throw new HttpError(400, 'Send two JPEG frames')
    } catch (e) { slot.release(); throw e }
    try {
      return send(res, 200, { verdict: await judgeFrames(body), left: slot.left })
    } catch (e) {
      console.error('[vision]', e?.message ?? e)
      throw new HttpError(502, 'The screen check failed. It will try again on the next moment.')
    }
  }

  // --- sponsored cards ---
  if (req.method === 'GET' && p === '/api/ads') {
    const ads = pickAds(url.searchParams.get('placement') ?? '', Math.min(3, Number(url.searchParams.get('count') ?? 1)))
    for (const a of ads) countAd(req, a.id, 'impression')
    return send(res, 200, { ads }, { 'Cache-Control': 'no-store' })
  }
  if (req.method === 'POST' && (r = m(/^\/api\/ads\/([\w-]+)\/click$/))) {
    if (loadAds().some((a) => a.id === r[1])) countAd(req, r[1], 'click')
    return send(res, 200, { ok: true })
  }

  throw new HttpError(404, 'Not found')
}

// ---------------- server ----------------
const server = http.createServer(async (req, res) => {
  try {
    await route(req, res)
  } catch (e) {
    const status = e.status ?? 500
    if (status >= 500) console.error(e)
    if (!res.headersSent) send(res, status, { error: e.message ?? 'Server error' })
    else res.end()
  }
})

// Housekeeping: expired free links and abandoned uploads.
async function cleanup() {
  for (const c of [...clips.expired(), ...clips.stalePending()]) {
    await storage.remove(c.video_key)
    await storage.remove(c.thumb_key)
    clips.remove(c.id)
  }
  for (const c of clips.recentlyDeleted()) {
    await storage.remove(c.video_key)
    await storage.remove(c.thumb_key)
  }
  counters.prune(new Date().toISOString().slice(0, 10))
}
setInterval(() => void cleanup(), 3600_000).unref()
void cleanup()

server.listen(config.port, config.host, () => {
  console.log(`[clutch-cloud] listening on ${config.publicUrl} (${config.host}:${config.port}, storage: ${config.storage})`)
  console.log(`[clutch-cloud] sign-in providers: ${enabledProviders().map((x) => x.label).join(', ') || 'none configured'}`)
})
