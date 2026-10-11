import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import fs from 'node:fs'
import { z } from 'zod'

const Title = z.object({
  /** 2-7 words, no quotes, no emoji, no hashtags. */
  title: z.string()
})

const SYSTEM = `You name gameplay clips. You get a screenshot from the middle of the clip, the game name, and sometimes what triggered it. Reply with a short, specific, human-sounding title of 2 to 7 words that a gamer would actually use, describing what is happening on screen (e.g. "Triple kill on B site", "Last-second aerial goal", "Ragdolled off the cliff"). No quotes, no emoji, no hashtags, no game name unless it helps.`

/**
 * Optional AI layer: one small vision request per new clip. Off by default; everything works without it.
 */
export async function suggestTitle(opts: { apiKey: string; model: string; thumbnail: string; game: string; event?: string; trigger: string }): Promise<string | null> {
  const client = opts.apiKey ? new Anthropic({ apiKey: opts.apiKey }) : process.env.ANTHROPIC_API_KEY ? new Anthropic() : null
  if (!client || !fs.existsSync(opts.thumbnail)) return null
  const res = await client.messages.parse({
    model: opts.model,
    max_tokens: 1024,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: zodOutputFormat(Title) },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(opts.thumbnail).toString('base64') } },
          { type: 'text', text: `Game: ${opts.game}\nTriggered by: ${opts.trigger}${opts.event ? ` (${opts.event})` : ''}` }
        ]
      }
    ]
  })
  if (res.stop_reason === 'refusal') return null
  const t = res.parsed_output?.title?.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 80)
  return t || null
}
