// Generates resources/icon.png (256px) and resources/icon-32.png without any image library:
// a rounded square with a violet→cyan gradient and a white "play/clip" glyph.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const lerp = (a, b, t) => a + (b - a) * t
function draw(size) {
  const r = size * 0.22
  const inside = (x, y) => {
    const cx = Math.max(r, Math.min(size - r, x)), cy = Math.max(r, Math.min(size - r, y))
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  // glyph: a play triangle with a notch (clip)
  const tri = (x, y) => {
    const px = (x / size - 0.36) / 0.36, py = (y / size - 0.5) / 0.28
    return px >= 0 && px <= 1 && Math.abs(py) <= 1 - px
  }
  const bar = (x, y) => x / size > 0.26 && x / size < 0.33 && Math.abs(y / size - 0.5) < 0.28
  return png(size, (x, y) => {
    const ss = 4; let cov = 0, gcov = 0
    for (let i = 0; i < ss; i++) for (let j = 0; j < ss; j++) {
      const sx = x + (i + 0.5) / ss, sy = y + (j + 0.5) / ss
      if (inside(sx, sy)) cov++
      if (tri(sx, sy) || bar(sx, sy)) gcov++
    }
    cov /= ss * ss; gcov /= ss * ss
    const t = (x + y) / (2 * size)
    const base = [lerp(124, 34, t), lerp(92, 211, t), lerp(255, 238, t)]
    const col = base.map((c, i) => lerp(c, 255, gcov))
    return [Math.round(col[0]), Math.round(col[1]), Math.round(col[2]), Math.round(255 * cov)]
  })
}

const out = path.resolve(process.argv[2] ?? 'resources')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'icon.png'), draw(256))
fs.writeFileSync(path.join(out, 'icon-32.png'), draw(32))
console.log('wrote', path.join(out, 'icon.png'))
