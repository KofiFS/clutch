import fs from 'node:fs'
import path from 'node:path'
import type { Clip } from '../../shared/types'
import { detectEncoders, ffmpegPath, ffprobePath, run } from '../capture/ffmpeg'

const WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+\/?$/

/** Only Discord webhook URLs are accepted (a localhost override exists for automated tests). */
export function isWebhookUrl(url: string): boolean {
  const u = url.trim()
  if (WEBHOOK_RE.test(u)) return true
  const testHost = process.env.CLIPFORGE_TEST_WEBHOOK_HOST
  return !!testHost && u.startsWith(`http://${testHost}/api/webhooks/`)
}

export interface WebhookInfo {
  name: string
  channelId: string
  guildId?: string
}

/** Reads the webhook's own info. Posts nothing, so it is safe as a "test connection". */
export async function checkWebhook(url: string): Promise<WebhookInfo> {
  if (!isWebhookUrl(url)) throw new Error('That is not a Discord webhook URL. Copy it from Channel settings → Integrations → Webhooks.')
  const res = await fetch(url.trim())
  if (res.status === 401 || res.status === 404) throw new Error('Discord says this webhook does not exist anymore. Create a new one and paste it again.')
  if (!res.ok) throw new Error(`Discord returned ${res.status}`)
  const j = (await res.json()) as { name?: string; channel_id?: string; guild_id?: string }
  return { name: j.name ?? 'Webhook', channelId: j.channel_id ?? '', guildId: j.guild_id }
}

async function videoInfo(file: string) {
  const { stdout } = await run(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', file])
  try {
    const j = JSON.parse(stdout)
    const st = j.streams?.[0] ?? {}
    return { codec: String(st.codec_name ?? ''), width: Number(st.width ?? 0), height: Number(st.height ?? 0), duration: Number(j.format?.duration ?? 0) }
  } catch {
    return { codec: '', width: 0, height: 0, duration: 0 }
  }
}

/**
 * Discord only plays H.264 inline and caps attachments (10 MB on most servers). Returns a file that
 * fits: the original if it already does, otherwise a cached H.264 copy sized to the limit.
 */
export async function makeShareable(clip: Clip, maxMb: number, cacheDir: string): Promise<{ file: string; transcoded: boolean }> {
  const limit = maxMb * 1024 * 1024
  const info = await videoInfo(clip.file)
  const size = fs.statSync(clip.file).size
  if (info.codec === 'h264' && size <= limit && info.width <= 1920) return { file: clip.file, transcoded: false }

  fs.mkdirSync(cacheDir, { recursive: true })
  const out = path.join(cacheDir, `${clip.id}-${maxMb}mb.mp4`)
  if (fs.existsSync(out) && fs.statSync(out).size <= limit) return { file: out, transcoded: true }

  const enc = await detectEncoders()
  const hw = enc.available.includes('h264_nvenc') ? 'h264_nvenc' : enc.available.includes('h264_amf') ? 'h264_amf' : enc.available.includes('h264_qsv') ? 'h264_qsv' : 'libx264'
  const duration = Math.max(1, info.duration || clip.durationSec)
  const audioKbps = 128
  let budget = 0.9
  for (let attempt = 0; attempt < 3; attempt++) {
    const videoKbps = Math.max(250, Math.floor(((limit * 8 * budget) / duration) / 1000 - audioKbps))
    // Pick a resolution the bitrate can carry: ~1920 wide above 4 Mbps, 1280 above 1.5 Mbps, else 854.
    const targetW = videoKbps > 4000 ? 1920 : videoKbps > 1500 ? 1280 : 854
    const w = Math.min(targetW, info.width || targetW)
    const fps = videoKbps > 2500 ? 60 : 30
    const vcodec = hw === 'libx264'
      ? ['-c:v', 'libx264', '-preset', 'veryfast']
      : [ '-c:v', hw, ...(hw === 'h264_nvenc' ? ['-preset', 'p5', '-rc', 'vbr'] : []) ]
    const r = await run(ffmpegPath(), [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', clip.file, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', `scale=${w}:-2:flags=lanczos,fps=${fps},format=yuv420p`,
      ...vcodec, '-b:v', `${videoKbps}k`, '-maxrate', `${Math.round(videoKbps * 1.2)}k`, '-bufsize', `${videoKbps * 2}k`,
      '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ac', '2', '-movflags', '+faststart', out
    ], { timeoutMs: 10 * 60_000 })
    if (r.code !== 0) throw new Error(`Could not make a Discord-sized copy: ${r.stderr.trim().split('\n').pop()}`)
    if (fs.statSync(out).size <= limit) return { file: out, transcoded: true }
    budget *= 0.8
  }
  throw new Error(`This clip is too long to fit in ${maxMb} MB. Trim it first or raise the size limit (boosted servers allow 50 MB).`)
}

export interface PostOptions {
  webhookUrl: string
  clip: Clip
  file: string
  heading?: string
  mention?: string
  note?: string
}

/** Posts the clip as an attachment with a small embed. Discord plays the mp4 inline. */
export async function postClip(o: PostOptions): Promise<{ messageId: string; channelId: string }> {
  if (!isWebhookUrl(o.webhookUrl)) throw new Error('Discord webhook URL is not set or invalid')
  const fileName = `${o.clip.game} - ${o.clip.title}`.replace(/[^\w\- ().]+/g, '').slice(0, 80).trim() + '.mp4'
  const fields = [
    { name: 'Game', value: o.clip.game, inline: true },
    { name: 'Length', value: `${Math.round(o.clip.durationSec)}s`, inline: true },
    ...(o.clip.event ? [{ name: 'Moment', value: o.clip.event, inline: true }] : [])
  ]
  const payload = {
    username: 'Clutch',
    content: [o.mention, o.heading].filter(Boolean).join(' ') || undefined,
    allowed_mentions: { parse: o.mention?.includes('@everyone') || o.mention?.includes('@here') ? ['everyone'] : [] },
    embeds: [
      {
        title: o.clip.title.slice(0, 256),
        description: o.note?.slice(0, 1000) || undefined,
        color: 0x8b6cff,
        fields,
        timestamp: o.clip.createdAt,
        footer: { text: 'Clipped with Clutch' }
      }
    ],
    attachments: [{ id: 0, filename: fileName }]
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const form = new FormData()
    form.append('payload_json', JSON.stringify(payload))
    form.append('files[0]', new Blob([fs.readFileSync(o.file)], { type: 'video/mp4' }), fileName)
    const res = await fetch(`${o.webhookUrl.trim().replace(/\/$/, '')}?wait=true`, { method: 'POST', body: form })
    if (res.status === 429) {
      const j = (await res.json().catch(() => ({}))) as { retry_after?: number }
      await new Promise((r) => setTimeout(r, Math.min(30, j.retry_after ?? 2) * 1000))
      continue
    }
    if (res.status === 413) throw new Error('Discord rejected the file as too large. Lower the size limit in Settings → Discord.')
    if (!res.ok) throw new Error(`Discord returned ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const j = (await res.json()) as { id: string; channel_id: string }
    return { messageId: j.id, channelId: j.channel_id }
  }
  throw new Error('Discord is rate limiting this webhook. Try again in a minute.')
}
