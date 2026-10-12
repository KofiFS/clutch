import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { VisionRules } from '../../shared/types'

const Verdict = z.object({
  /** True only when the user's rules say this moment should be clipped. */
  clip: z.boolean(),
  /** Short label for what happened, e.g. "Double kill", "Goal scored". Empty when nothing notable. */
  event: z.string(),
  confidence: z.number().min(0).max(1),
  /** One sentence of reasoning, shown in the activity feed. */
  why: z.string(),
  /** Seconds *before* the newest frame the moment probably started (0-20). */
  secondsAgo: z.number().min(0).max(20)
})
export type VisionVerdict = z.infer<typeof Verdict>
export type CloudJudge = (req: { prev: string; frame: string; rules: string; game: string }) => Promise<VisionVerdict | null>

const SYSTEM = `You watch gameplay screenshots for a clip-recording tool. The user wrote rules in plain English describing which moments they want saved as clips and which to ignore.

You receive the previous screenshot and the newest screenshot (a few seconds apart) plus the name of the game. Decide whether the NEWEST screenshot shows a moment that matches the user's rules: look for kill feeds, elimination banners, goal/score popups, round-win screens, achievement toasts, ragdolls, and other on-screen evidence. Compare the two frames to notice what just changed.

Be conservative: only set clip=true when the on-screen evidence is clear. Never clip menus, lobbies, loading screens, inventory, or the desktop unless the rules explicitly ask for them. Estimate secondsAgo so the clip can start before the moment.`

/**
 * "Tell it what to clip" - sends low-rate screenshots to Claude with the user's plain-English
 * rules and returns a verdict. One request per interval; the caller handles cooldowns.
 */
export class VisionJudge {
  private client: Anthropic | null = null
  private prev: Buffer | null = null
  private busy = false

  /**
   * `cloud` judges through the Clutch account (daily limit) for people without their own key.
   * The user's own key wins when both exist.
   */
  constructor(apiKey: string, private model: string, private cloud: CloudJudge | null = null) {
    try {
      // A key from Settings wins; otherwise the SDK's own lookup (ANTHROPIC_API_KEY, `ant auth login` profile).
      this.client = apiKey ? new Anthropic({ apiKey }) : process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Anthropic() : null
    } catch {
      this.client = null
    }
  }

  get ready() {
    return !!this.client || !!this.cloud
  }

  /** Where screenshots go while screen watching is on (shown to the user). */
  get destination(): 'anthropic' | 'clutch' | null {
    return this.client ? 'anthropic' : this.cloud ? 'clutch' : null
  }

  reset() {
    this.prev = null
  }

  /** Keep a frame as "previous" without asking the AI (calm moments are skipped for free). */
  remember(frame: Buffer) {
    this.prev = frame
  }

  async judge(frame: Buffer, rules: VisionRules, game: string): Promise<VisionVerdict | null> {
    if (!this.ready || this.busy) return null
    const prev = this.prev
    this.prev = frame
    if (!prev) return null
    this.busy = true
    try {
      if (!this.client && this.cloud) return await this.cloud({ prev: prev.toString('base64'), frame: frame.toString('base64'), rules: rules.rules, game })
      if (!this.client) return null
      const content: Anthropic.ContentBlockParam[] = [
        { type: 'text', text: `Game: ${game || 'unknown'}\n\nUser rules:\n${rules.rules}\n\nPrevious frame:` },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: prev.toString('base64') } },
        { type: 'text', text: 'Newest frame:' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame.toString('base64') } }
      ]
      const res = await this.client.messages.parse({
        model: this.model,
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'low', format: zodOutputFormat(Verdict) },
        messages: [{ role: 'user', content }]
      })
      if (res.stop_reason === 'refusal') return { clip: false, event: '', confidence: 0, why: 'Model declined to analyze this frame', secondsAgo: 0 }
      return res.parsed_output ?? null
    } finally {
      this.busy = false
    }
  }
}
