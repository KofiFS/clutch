import fs from 'node:fs'
import path from 'node:path'
import { createHash, createHmac } from 'node:crypto'
import { Readable } from 'node:stream'
import { config } from './config.mjs'
import { sign } from './jwt.mjs'

/**
 * Two storage drivers with the same shape:
 *  - local: files under DATA_DIR/files, uploaded with a signed one-time PUT to this server
 *  - s3:    any S3-compatible bucket (Cloudflare R2 has no download fees, ideal for share links),
 *           using presigned URLs so video bytes never pass through this server
 */
const filesDir = path.join(config.dataDir, 'files')
fs.mkdirSync(filesDir, { recursive: true })
const safeKey = (key) => key.replace(/[^\w./-]/g, '_').replace(/\.\.+/g, '_')

// ---------------- S3 SigV4 presigning (query-string auth) ----------------
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const hmac = (k, s) => createHmac('sha256', k).update(s).digest()
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

function presign(method, key, expiresSeconds = 900) {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3
  const url = new URL(`${endpoint.replace(/\/$/, '')}/${bucket}/${key.split('/').map(rfc3986).join('/')}`)
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = amzDate.slice(0, 8)
  const scope = `${date}/${region}/s3/aws4_request`
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host'
  }
  const qs = Object.keys(params).sort().map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`).join('&')
  const canonical = [method, url.pathname, qs, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
  const kSign = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, date), region), 's3'), 'aws4_request')
  return `${url.origin}${url.pathname}?${qs}&X-Amz-Signature=${createHmac('sha256', kSign).update(toSign).digest('hex')}`
}

async function s3Delete(key) {
  await fetch(presign('DELETE', key, 300), { method: 'DELETE' }).catch(() => undefined)
}

// ---------------- driver API ----------------
export const storage = {
  /** Where the desktop app should PUT the bytes. */
  uploadUrl(key, contentType, maxBytes) {
    if (config.storage === 's3') return { url: presign('PUT', key), headers: { 'Content-Type': contentType } }
    const ticket = sign({ key, max: maxBytes }, { kind: 'upload', ttlSeconds: 3600 })
    return { url: `${config.publicUrl}/upload/${encodeURIComponent(ticket)}`, headers: { 'Content-Type': contentType } }
  },
  /** Size of an uploaded object, or -1 if missing. */
  async size(key) {
    if (config.storage === 's3') {
      const r = await fetch(presign('HEAD', key, 300), { method: 'HEAD' }).catch(() => null)
      return r && r.ok ? Number(r.headers.get('content-length') ?? 0) : -1
    }
    try { return fs.statSync(path.join(filesDir, safeKey(key))).size } catch { return -1 }
  },
  async remove(key) {
    if (!key) return
    if (config.storage === 's3') return s3Delete(key)
    try { fs.unlinkSync(path.join(filesDir, safeKey(key))) } catch { /* gone */ }
  },
  /** Local driver only: write an upload stream to disk, refusing more than `max` bytes. */
  async writeLocal(key, req, max) {
    const file = path.join(filesDir, safeKey(key))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.part`
    let n = 0
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp)
      req.on('data', (chunk) => {
        n += chunk.length
        if (n > max) { req.destroy(); out.destroy(); reject(Object.assign(new Error('too large'), { status: 413 })) }
      })
      req.pipe(out)
      out.on('finish', resolve)
      out.on('error', reject)
      req.on('error', reject)
    })
    fs.renameSync(tmp, file)
    return n
  },
  /** Serve an object to a browser: range-capable stream (local) or a short-lived redirect (s3). */
  serve(key, req, res, contentType) {
    if (config.storage === 's3') {
      res.writeHead(302, { Location: presign('GET', key, 3600), 'Cache-Control': 'private, max-age=3000' })
      return res.end()
    }
    const file = path.join(filesDir, safeKey(key))
    let st
    try { st = fs.statSync(file) } catch { res.writeHead(404); return res.end('not found') }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    const head = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600' }
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]))
      let end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1
      if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end() }
      res.writeHead(206, { ...head, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}` })
      return Readable.from(fs.createReadStream(file, { start, end })).pipe(res)
    }
    res.writeHead(200, { ...head, 'Content-Length': st.size })
    fs.createReadStream(file).pipe(res)
  }
}
