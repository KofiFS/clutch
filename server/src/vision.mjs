import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { config } from './config.mjs'

/**
 * "Watch the screen" for signed-in users without their own Anthropic key. The app only sends a
 * pair of small frames when its own cheap checks (big screen change, loud audio) fire, and is
 * capped per minute; this adds a daily limit per plan. Same prompt and fields as the desktop
 * app's src/main/triggers/vision.ts; keep them in step.
 */
const SYSTEM = `You watch gameplay screenshots for a clip-recording tool. The user wrote rules in plain English describing which moments they want saved as clips and which to ignore.

You receive the previous screenshot and the newest screenshot (a few seconds apart) plus the name of the game. Decide whether the NEWEST screenshot shows a moment that matches the user's rules: look for kill feeds, elimination banners, goal/score popups, round-win screens, achievement toasts, ragdolls, and other on-screen evidence. Compare the two frames to notice what just changed.

Be conservative: only set clip=true when the on-screen evidence is clear. Never clip menus, lobbies, loading screens, inventory, or the desktop unless the rules explicitly ask for them. Estimate secondsAgo so the clip can start before the moment.`

const Verdict = z.object({
  clip: z.boolean(),
  event: z.string(),
  confidence: z.number().min(0).max(1),
  why: z.string(),
  secondsAgo: z.number().min(0).max(20)
})

export const visionEnabled = () => !!config.anthropicKey

const used = new Map()
/** Checks left today for this user. In memory: a restart only ever errs on the generous side. */
export function visionChecksLeft(userId, limit) {
  const key = `${userId}:${new Date().toISOString().slice(0, 10)}`
  return { key, left: Math.max(0, limit - (used.get(key) ?? 0)) }
}
export function countVisionCheck(key) {
  used.set(key, (used.get(key) ?? 0) + 1)
  if (used.size > 50_000) used.clear()
}

let client = null
export async function judgeFrames({ prev, frame, rules, game }) {
  client ??= new Anthropic({ apiKey: config.anthropicKey })
  const res = await client.messages.parse({
    model: config.visionModel,
    max_tokens: 1024,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: zodOutputFormat(Verdict) },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `Game: ${String(game || 'unknown').slice(0, 80)}\n\nUser rules:\n${String(rules || '').slice(0, 1500)}\n\nPrevious frame:` },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: prev } },
        { type: 'text', text: 'Newest frame:' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame } }
      ]
    }]
  })
  if (res.stop_reason === 'refusal') return { clip: false, event: '', confidence: 0, why: 'Model declined to analyze this frame', secondsAgo: 0 }
  return res.parsed_output ?? null
}
