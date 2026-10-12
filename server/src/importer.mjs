import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { config } from './config.mjs'

/**
 * Smart read of settings screenshots for signed-in users who don't have their own Anthropic key.
 * Uses the server's ANTHROPIC_API_KEY, limited per user per day. Same prompt and fields as the
 * desktop app's src/main/importer/smart.ts; keep them in step.
 */
const SYSTEM = `You read screenshots of a game-clip recorder's settings (Medal, OBS Studio, NVIDIA App / ShadowPlay, Xbox Game Bar, SteelSeries Moments, AMD Adrenalin, Outplayed or similar) and report the recording settings you can actually see.

Only report a value that is visible in the screenshots. Use null for anything not shown. Never guess.
- fps: recording frame rate.
- outputHeight: recording/output resolution height in pixels (1080 for 1080p or 1920x1080). Use 0 when it says native, in-game, source or the display's resolution.
- quality: the quality preset mapped to low, medium, high or max (lossless, original, ultra, indistinguishable = max).
- bitrateMbps: video bitrate in Mbps (convert Kbps).
- bufferSeconds: replay buffer / instant replay length in seconds.
- clipSeconds: total clip length in seconds (Medal's "Clip length").
- hotkey: the key that saves a clip/replay, as an Electron accelerator such as "F8", "Alt+F10" or "Ctrl+Shift+S" (modifiers first: Ctrl, Alt, Shift, Super).
- saveFolder: the folder clips or recordings are saved to, as a Windows path.
- mic: the microphone device name exactly as shown, "off" if the mic is turned off, or null.
- systemAudio: true if game/desktop audio is recorded, false if turned off, null if not shown.
- app: which app the screenshots are from.
- notes: up to 3 short notes about settings you saw that a recorder could not import (e.g. "Webcam overlay is on").`

const ReadSettings = z.object({
  app: z.string(),
  fps: z.number().nullable(),
  outputHeight: z.number().nullable(),
  quality: z.enum(['low', 'medium', 'high', 'max']).nullable(),
  bitrateMbps: z.number().nullable(),
  bufferSeconds: z.number().nullable(),
  clipSeconds: z.number().nullable(),
  hotkey: z.string().nullable(),
  saveFolder: z.string().nullable(),
  mic: z.string().nullable(),
  systemAudio: z.boolean().nullable(),
  notes: z.array(z.string())
})

export const smartReadEnabled = () => !!config.anthropicKey

/** Reads used today, per user. Resets when the server restarts, which only ever errs on the generous side. */
const used = new Map()
export function smartReadsLeft(userId, limit) {
  const key = `${userId}:${new Date().toISOString().slice(0, 10)}`
  return { key, left: Math.max(0, limit - (used.get(key) ?? 0)) }
}
export function countSmartRead(key) {
  used.set(key, (used.get(key) ?? 0) + 1)
  if (used.size > 50_000) used.clear()
}

let client = null
export async function smartRead(images) {
  client ??= new Anthropic({ apiKey: config.anthropicKey })
  const res = await client.messages.parse({
    model: config.smartReadModel,
    max_tokens: 2048,
    system: SYSTEM,
    output_config: { effort: 'low', format: zodOutputFormat(ReadSettings) },
    messages: [{
      role: 'user',
      content: [
        ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } })),
        { type: 'text', text: 'Report the recording settings shown in these screenshots.' }
      ]
    }]
  })
  if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error('Could not read those screenshots')
  return res.parsed_output
}
