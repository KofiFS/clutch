import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { ImportedSettings } from '../../shared/types'

/**
 * Optional "smart read" of settings screenshots with Claude, for screens the offline reader can't
 * make sense of. Runs here with the user's own API key, or on the Clutch server for signed-in users
 * (server/src/importer.mjs uses the same prompt and fields).
 */
export const READ_SETTINGS_SYSTEM = `You read screenshots of a game-clip recorder's settings (Medal, OBS Studio, NVIDIA App / ShadowPlay, Xbox Game Bar, SteelSeries Moments, AMD Adrenalin, Outplayed or similar) and report the recording settings you can actually see.

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

export const ReadSettings = z.object({
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

/** Model output -> ImportedSettings (nulls dropped, "native" and "off" mapped). */
export function fromModel(r: z.infer<typeof ReadSettings>): ImportedSettings {
  const f: ImportedSettings = { app: r.app || 'another recorder', notes: (r.notes ?? []).slice(0, 3) }
  if (r.fps && r.fps >= 20 && r.fps <= 360) f.fps = Math.round(r.fps)
  if (r.outputHeight === 0) f.outputHeight = 'native'
  else if (r.outputHeight && r.outputHeight >= 360 && r.outputHeight <= 4320) f.outputHeight = Math.round(r.outputHeight)
  if (r.quality) f.quality = r.quality
  if (r.bitrateMbps && r.bitrateMbps > 0.5 && r.bitrateMbps < 500) f.bitrateMbps = r.bitrateMbps
  if (r.bufferSeconds && r.bufferSeconds >= 5) f.bufferSeconds = Math.round(r.bufferSeconds)
  if (r.clipSeconds && r.clipSeconds >= 5) f.clipSeconds = Math.round(r.clipSeconds)
  if (r.hotkey && /^((Ctrl|Alt|Shift|Super)\+)*([A-Z0-9]|F\d{1,2}|PageUp|PageDown|Home|End|Insert|Delete|PrintScreen|Space|num\d)$/.test(r.hotkey)) f.hotkey = r.hotkey
  if (r.saveFolder && /^[A-Za-z]:\\/.test(r.saveFolder)) f.saveFolder = r.saveFolder
  if (r.mic) f.mic = /^off$/i.test(r.mic) ? null : r.mic
  if (r.systemAudio !== null) f.systemAudio = r.systemAudio
  return f
}

/** Smart read with the user's own Anthropic key (or ANTHROPIC_API_KEY). */
export async function smartReadLocal(opts: { apiKey: string; model: string; images: { media_type: 'image/jpeg'; data: string }[] }): Promise<ImportedSettings> {
  const client = opts.apiKey ? new Anthropic({ apiKey: opts.apiKey }) : new Anthropic()
  const res = await client.messages.parse({
    model: opts.model,
    max_tokens: 2048,
    system: READ_SETTINGS_SYSTEM,
    output_config: { effort: 'low', format: zodOutputFormat(ReadSettings) },
    messages: [{
      role: 'user',
      content: [
        ...opts.images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.media_type, data: img.data } })),
        { type: 'text', text: 'Report the recording settings shown in these screenshots.' }
      ]
    }]
  })
  if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error('The smart read could not read those screenshots')
  return fromModel(res.parsed_output)
}
