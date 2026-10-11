import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ts': 'video/mp2t',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
}

const norm = (p: string) => path.normalize(p).toLowerCase()

/** True when `file` sits inside one of `roots` (case-insensitive, Windows paths). */
export function isInside(file: string, roots: string[]): boolean {
  const f = norm(file)
  return roots.some((r) => {
    const root = norm(r).replace(/[\\/]+$/, '')
    return root.length > 3 && (f === root || f.startsWith(root + path.sep))
  })
}

/**
 * Serves a local file with HTTP range support. Video elements ask for byte ranges when you seek;
 * answering every request with the whole file (as plain file:// fetches do through a custom
 * protocol) makes the video unseekable, so clicking the timeline jumps back to 0.
 */
export function serveFile(filePath: string, req: Request): Response {
  let size: number
  try {
    const st = fs.statSync(filePath)
    if (!st.isFile()) return new Response('not found', { status: 404 })
    size = st.size
  } catch {
    return new Response('not found', { status: 404 })
  }
  const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const common = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }
  const body = (start: number, end: number) => Readable.toWeb(fs.createReadStream(filePath, { start, end })) as unknown as ReadableStream

  const range = req.headers.get('range')
  if (!range) {
    return new Response(size ? body(0, size - 1) : null, { status: 200, headers: { ...common, 'Content-Length': String(size) } })
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!m || (!m[1] && !m[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  let start: number
  let end: number
  if (!m[1]) {
    // Suffix range: the last N bytes.
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  return new Response(body(start, end), {
    status: 206,
    headers: { ...common, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` }
  })
}
