import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from './config.mjs'

const b64 = (buf) => Buffer.from(buf).toString('base64url')

/** Small HS256 JWT. `kind` keeps login tokens, upload tickets and OAuth state from being swapped. */
export function sign(payload, { kind, ttlSeconds }) {
  const body = { ...payload, kind, exp: Math.floor(Date.now() / 1000) + ttlSeconds }
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const data = `${head}.${b64(JSON.stringify(body))}`
  return `${data}.${b64(createHmac('sha256', config.jwtSecret).update(data).digest())}`
}

export function verify(token, kind) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const expected = createHmac('sha256', config.jwtSecret).update(`${parts[0]}.${parts[1]}`).digest()
  const got = Buffer.from(parts[2], 'base64url')
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null
  try {
    const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (body.kind !== kind || !body.exp || body.exp < Date.now() / 1000) return null
    return body
  } catch {
    return null
  }
}
