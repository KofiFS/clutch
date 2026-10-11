import { useStore } from '../lib/store'
import { Field, Section, Toggle } from '../components/ui'
import { GamePicker } from '../components/GamePicker'

const PRESETS = [
  { name: 'Shooter kills', text: 'Clip every kill, headshot, multi-kill and clutch I get. Also clip when I die in a funny or embarrassing way. Never clip menus, loading screens, the scoreboard or buy phase.' },
  { name: 'Goals (Rocket League etc.)', text: 'Clip when a goal is scored by me or my team, saves, and aerials that connect. Do not clip kickoffs, replays of goals, the menu or the post-game screen.' },
  { name: 'Funny moments', text: 'Clip anything that looks funny: ragdoll physics, glitches, unexpected deaths, weird animations, or text chat reactions. Ignore normal gameplay and menus.' },
  { name: 'Wins only', text: 'Only clip the end of rounds or matches that I win (victory screens, "Winner", "#1", round win banners). Ignore everything else.' }
]

export default function Rules() {
  const { settings, save } = useStore()
  if (!settings) return null
  const v = settings.vision
  const vo = settings.voice
  const setVision = (patch: Partial<typeof v>) => save({ vision: { ...v, ...patch } })
  const setVoice = (patch: Partial<typeof vo>) => save({ voice: { ...vo, ...patch } })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">What to clip</h1>
        <p className="text-muted text-sm mt-1">Three ways a clip gets made: your hotkey, moments the AI spots on screen, and people talking. Mix them however you like.</p>
      </header>

      <Section
        title="Watch the screen for moments"
        desc="Describe in plain English what you want clipped. Screenshots are checked a few seconds apart and a clip is saved when the on-screen evidence matches."
        right={<Toggle checked={v.enabled} onChange={(enabled) => void setVision({ enabled })} label={v.enabled ? 'On' : 'Off'} />}
      >
        {!settings.ai.anthropicApiKey && <p className="text-sm text-warn">Add your Anthropic API key under Settings → AI to turn this on.</p>}
        <Field label="Your rules">
          <textarea className="input min-h-28" value={v.rules} onChange={(e) => void setVision({ rules: e.target.value })} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => <button key={p.name} className="chip cursor-pointer hover:border-accent/60" onClick={() => void setVision({ rules: p.text })}>{p.name}</button>)}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Check every ${v.intervalSeconds}s`} hint="Shorter = catches more, costs more API calls. 3s is a good default.">
            <input type="range" min={2} max={15} step={1} value={v.intervalSeconds} className="w-full" onChange={(e) => void setVision({ intervalSeconds: Number(e.target.value) })} />
          </Field>
          <Field label={`Minimum confidence ${Math.round(v.minConfidence * 100)}%`} hint="Raise it if you get clips of nothing; lower it if it misses moments.">
            <input type="range" min={0.3} max={0.95} step={0.05} value={v.minConfidence} className="w-full" onChange={(e) => void setVision({ minConfidence: Number(e.target.value) })} />
          </Field>
        </div>
      </Section>

      <Section
        title="Only when people talk"
        desc="Save a clip of every stretch of conversation: your mic, your friends in voice chat, or both. Great for Discord moments."
        right={<Toggle checked={vo.enabled} onChange={(enabled) => void setVoice({ enabled })} label={vo.enabled ? 'On' : 'Off'} />}
      >
        <div className="grid grid-cols-2 gap-4">
          <Toggle checked={vo.onMic} onChange={(onMic) => void setVoice({ onMic })} label="My microphone" hint={settings.capture.micDevice ? settings.capture.micDevice : 'Pick a mic under Settings → Audio'} />
          <Toggle checked={vo.onSystemAudio} onChange={(onSystemAudio) => void setVoice({ onSystemAudio })} label="Voice chat / game audio" hint="Uses system audio. Game sound counts too, so raise the threshold if it triggers on gunfire." />
        </div>
        <div className="grid grid-cols-4 gap-4">
          <Field label={`Threshold ${vo.thresholdDb} dB`}>
            <input type="range" min={-60} max={-10} step={1} value={vo.thresholdDb} className="w-full" onChange={(e) => void setVoice({ thresholdDb: Number(e.target.value) })} />
          </Field>
          <Field label={`Starts after ${vo.minSpeechSeconds}s`}>
            <input type="range" min={0.5} max={5} step={0.5} value={vo.minSpeechSeconds} className="w-full" onChange={(e) => void setVoice({ minSpeechSeconds: Number(e.target.value) })} />
          </Field>
          <Field label={`Ends after ${vo.silenceSeconds}s quiet`}>
            <input type="range" min={1} max={15} step={1} value={vo.silenceSeconds} className="w-full" onChange={(e) => void setVoice({ silenceSeconds: Number(e.target.value) })} />
          </Field>
          <Field label={`Max ${vo.maxClipSeconds}s per clip`}>
            <input type="range" min={10} max={Math.max(30, settings.capture.bufferSeconds - 10)} step={5} value={vo.maxClipSeconds} className="w-full" onChange={(e) => void setVoice({ maxClipSeconds: Number(e.target.value) })} />
          </Field>
        </div>
      </Section>

      <Section title="Which games" desc="Pick from what's running now or games you've already clipped. Matches the game's process or window title. The hotkey always works.">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Never auto-clip in" hint="Discord, browsers, work apps…">
            <GamePicker value={settings.blocklist} onChange={(blocklist) => void save({ blocklist })} placeholder="No games blocked" />
          </Field>
          <Field label="Only auto-clip in" hint="Leave empty to allow every game.">
            <GamePicker value={settings.allowlist} onChange={(allowlist) => void save({ allowlist })} placeholder="Every game allowed" />
          </Field>
        </div>
      </Section>
    </div>
  )
}
