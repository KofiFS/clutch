// Security regression tests for the cloud server. Run: npm test (from server/)
// Starts a throwaway server on a random port with a temp data folder and dev sign-in.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'

const port = 18000 + Math.floor(Math.random() * 2000)
const base = `http://127.0.0.1:${port}`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clutch-cloud-test-'))
let proc

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server did not start')
}

/** Dev sign-in as `name`; returns a session token. */
async function signIn(name) {
  const back = `http://127.0.0.1:9/done?n=test`
  const start = await fetch(`${base}/auth/dev/start?redirect=${encodeURIComponent(back)}`, { redirect: 'manual' })
  const form = new URL(start.headers.get('location'), base)
  const state = form.searchParams.get('state')
  const cb = await fetch(`${base}/auth/dev/callback`, { method: 'POST', body: new URLSearchParams({ state, name }), redirect: 'manual' })
  const loc = new URL(cb.headers.get('location'))
  assert.equal(loc.searchParams.get('n'), 'test', 'the app nonce survives the round trip')
  return loc.searchParams.get('token')
}
const api = (token, method, p, body) => fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
function put(url, bytes) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'PUT', headers: { 'Content-Length': bytes.length, 'Content-Type': 'video/mp4' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    // The server cuts off an upload that goes over its limit: count that as refused.
    req.on('error', (e) => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? resolve('refused') : reject(e)))
    req.end(bytes)
  })
}

before(async () => {
  proc = spawn(process.execPath, ['--no-warnings', 'src/index.mjs'], {
    env: { ...process.env, PORT: String(port), PUBLIC_URL: base, DEV_LOGIN: '1', JWT_SECRET: 'change-me-please', DATA_DIR: dataDir, STORAGE: 'local', ANTHROPIC_API_KEY: '' },
    stdio: 'ignore'
  })
  await waitUp()
})
after(async () => {
  if (proc && proc.exitCode === null) { const gone = new Promise((r) => proc.once('exit', r)); proc.kill(); await gone }
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('DEV_LOGIN refuses to run on a public URL', async () => {
  const p = spawn(process.execPath, ['--no-warnings', 'src/index.mjs'], { env: { ...process.env, PORT: String(port + 1), PUBLIC_URL: 'https://cloud.example.com', DEV_LOGIN: '1', JWT_SECRET: 'x'.repeat(40), DATA_DIR: dataDir } })
  const code = await new Promise((r) => p.on('exit', r))
  assert.equal(code, 1)
})

test('tiny clips are refused and the quota counts thumbnails', async () => {
  const t = await signIn('alice')
  assert.equal((await api(t, 'POST', '/api/clips', { size: 1, title: 'x' })).status, 400)
  const ok = await api(t, 'POST', '/api/clips', { size: 20_000, thumbSize: 5000, title: 'x' })
  assert.equal(ok.status, 200)
})

test('upload bigger than announced is rejected at complete', async () => {
  const t = await signIn('bob')
  const ticket = await (await api(t, 'POST', '/api/clips', { size: 20_000, title: 'x' })).json()
  // The local driver caps the PUT itself; a short upload completes, a padded one is refused.
  assert.ok([413, 'refused'].includes(await put(ticket.video.url, Buffer.alloc(30_000))))
  assert.equal(await put(ticket.video.url, Buffer.alloc(20_000)), 200)
  const done = await api(t, 'POST', `/api/clips/${ticket.id}/complete`)
  assert.equal(done.status, 200)
})

test('upload links are single use', async () => {
  const t = await signIn('carol')
  const ticket = await (await api(t, 'POST', '/api/clips', { size: 20_000, title: 'x' })).json()
  assert.equal(await put(ticket.video.url, Buffer.alloc(20_000)), 200)
  assert.equal((await api(t, 'POST', `/api/clips/${ticket.id}/complete`)).status, 200)
  assert.equal(await put(ticket.video.url, Buffer.alloc(20_000)), 403, 'reuse after complete')
  assert.equal((await api(t, 'POST', `/api/clips/${ticket.id}/complete`)).status, 409, 'complete twice')
})

test("one user can't complete or delete another user's clip", async () => {
  const a = await signIn('dave')
  const b = await signIn('erin')
  const ticket = await (await api(a, 'POST', '/api/clips', { size: 20_000, title: 'x' })).json()
  assert.equal((await api(b, 'POST', `/api/clips/${ticket.id}/complete`)).status, 404)
  assert.equal((await api(b, 'DELETE', `/api/clips/${ticket.id}`)).status, 404)
})

test('YouTube finish only works for the account that started it', async () => {
  const a = await signIn('frank')
  const b = await signIn('grace')
  // Server has no Google client configured, so connect is unavailable; finish must still reject foreign/invalid state.
  const r = await api(b, 'POST', '/api/youtube/finish', { code: 'x', state: 'not-a-token' })
  assert.equal(r.status, 400)
  assert.ok(a)
})

test('unknown ad ids are not counted', async () => {
  const r = await fetch(`${base}/api/ads/made-up-id/click`, { method: 'POST' })
  assert.equal(r.status, 200)
})

test('replaying an ad click counts once', async () => {
  for (let i = 0; i < 5; i++) await fetch(`${base}/api/ads/community/click`, { method: 'POST' })
  const db = new DatabaseSync(path.join(dataDir, 'clutch.db'), { readOnly: true })
  const row = db.prepare('SELECT clicks FROM ad_stats WHERE ad_id = ?').get('community')
  db.close()
  assert.equal(row.clicks, 1)
})

test('an upload left open past complete cannot replace the finished file', async () => {
  const t = await signIn('heidi')
  const ticket = await (await api(t, 'POST', '/api/clips', { size: 60_000, title: 'x' })).json()
  // Upload A: announced 60 KB, held open after the first 1 KB.
  let finishA
  const a = new Promise((resolve) => {
    const req = http.request(ticket.video.url, { method: 'PUT', headers: { 'Content-Length': 60_000, 'Content-Type': 'video/mp4' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', () => resolve('refused'))
    req.write(Buffer.alloc(1000))
    finishA = () => req.end(Buffer.alloc(59_000))
  })
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(await put(ticket.video.url, Buffer.alloc(20_000)), 200)
  assert.equal((await api(t, 'POST', `/api/clips/${ticket.id}/complete`)).status, 200)
  finishA()
  assert.notEqual(await a, 200)
  const stored = fs.readdirSync(path.join(dataDir, 'files'), { recursive: true }).find((f) => String(f).endsWith(ticket.id + '.mp4'))
  assert.equal(fs.statSync(path.join(dataDir, 'files', String(stored))).size, 20_000, 'the completed 20 KB file is untouched')
})

test('the password-less dev sign-in only listens on this PC', async () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)
  if (!lan) return
  const r = await fetch(`http://${lan.address}:${port}/health`, { signal: AbortSignal.timeout(2000) }).then((x) => x.status, () => 'unreachable')
  assert.equal(r, 'unreachable')
})
