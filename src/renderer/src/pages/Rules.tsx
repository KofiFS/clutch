import { useEffect, useState } from 'react'
import { Eye, Flame, Gamepad2, Mic, Plus, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react'
import type { GameProfile } from '../../../shared/types'
import type { GameSummary, RunningApp } from '../../../shared/types'
import { fileUrl, useStore } from '../lib/store'
import { Badge, Field, GameIcon, Section, Segmented, Slider, Toggle } from '../components/ui'
import { LiveMeter } from '../components/AudioSources'
import { GamePicker } from '../components/GamePicker'

const PRESETS = [
  { name: 'Shooter kills', text: 'Clip every kill, headshot, multi-kill and clutch I get. Also clip when I die in a funny or embarrassing way. Never clip menus, loading screens, the scoreboard or buy phase.' },
  { name: 'Goals (Rocket League etc.)', text: 'Clip when a goal is scored by me or my team, saves, and aerials that connect. Do not clip kickoffs, replays of goals, the menu or the post-game screen.' },
  { name: 'Funny moments', text: 'Clip anything that looks funny: ragdoll physics, glitches, unexpected deaths, weird animations, or text chat reactions. Ignore normal gameplay and menus.' },
  { name: 'Wins only', text: 'Only clip the end of rounds or matches that I win (victory screens, "Winner", "#1", round win banners). Ignore everything else.' }
]

export default function Rules() {
  const { settings, save, status, setPage, account, signIn, goTo } = useStore()
  if (!settings) return null
  const v = settings.vision
  const vo = settings.voice
  const setVision = (patch: Partial<typeof v>) => save({ vision: { ...v, ...patch } })
  const setVoice = (patch: Partial<typeof vo>) => save({ voice: { ...vo, ...patch } })
  const hy = settings.hype
  const setHype = (patch: Partial<typeof hy>) => save({ hype: { ...hy, ...patch } })
  const hasKey = !!settings.ai.anthropicApiKey
  const viaAccount = !hasKey && account.signedIn
  const visionLimit = account.plan?.features.visionChecksPerDay

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">What to clip</h1>
        <p className="text-ink-3 text-sm mt-1">Your hotkey always works. On top of it, these triggers clip for you. The first two run entirely on your PC with no AI and almost no CPU.</p>
      </header>

      <Section
        title="Hype moments"
        icon={<Flame size={16} />}
        desc="Clips when you or your friends suddenly get loud: yelling, laughing, “NO WAY”. It learns how loud you normally are and fires on spikes above that."
        right={<div className="flex items-center gap-3"><Badge tone="ok">No AI</Badge><Toggle size="lg" checked={hy.enabled} onChange={(enabled) => void setHype({ enabled })} label={hy.enabled ? 'On' : 'Off'} /></div>}
      >
        <div className="grid grid-cols-2 gap-5">
          <Toggle checked={hy.onMic} onChange={(onMic) => void setHype({ onMic })} label="My microphone" hint="The most reliable source: game sound isn't on your mic." />
          <Toggle checked={hy.onSystemAudio} onChange={(onSystemAudio) => void setHype({ onSystemAudio })} label="Voice chat / game audio" hint="Catches friends going off, but explosions count too. Best for quieter games." />
        </div>
        <div className="grid grid-cols-2 gap-5">
          <Slider label="Spike size" value={hy.spikeDb} min={8} max={30} step={1} format={(n) => `+${n} dB`} onChange={(spikeDb) => void setHype({ spikeDb })} hint="How much louder than normal counts. Raise it if normal talking triggers clips." />
          <Slider label="Minimum loudness" value={hy.minDb} min={-40} max={-5} step={1} format={(n) => `${n} dB`} onChange={(minDb) => void setHype({ minDb })} hint="Ignore spikes in a quiet room below this level." />
        </div>
      </Section>

      <Section
        title="Only when people talk"
        icon={<Mic size={16} />}
        desc="Save a clip of every stretch of conversation: your mic, your friends in voice chat, or both. Great for Discord moments."
        right={<div className="flex items-center gap-3"><Badge tone="ok">No AI</Badge><Toggle size="lg" checked={vo.enabled} onChange={(enabled) => void setVoice({ enabled })} label={vo.enabled ? 'On' : 'Off'} /></div>}
      >
        <div className="grid grid-cols-2 gap-5">
          <div>
            <Toggle checked={vo.onMic} onChange={(onMic) => void setVoice({ onMic })} label="My microphone" hint={settings.capture.micDevice || 'No mic picked yet'} />
            {!settings.capture.micDevice && <button className="btn-sm mt-2 ml-12" onClick={() => goTo('settings', 'Audio sources')}><Mic size={13} /> Pick a mic</button>}
          </div>
          <Toggle checked={vo.onSystemAudio} onChange={(onSystemAudio) => void setVoice({ onSystemAudio })} label="Voice chat / game audio" hint="Uses system audio. Game sound counts too, so raise the threshold if gunfire triggers it." />
        </div>
        <div className="card-2 p-3 space-y-2">
          <LiveMeter source="mic" label="Mic" threshold={vo.thresholdDb} />
          <LiveMeter source="system" label="System" threshold={vo.thresholdDb} />
          <p className="text-[11px] text-ink-3">The line is your threshold: anything past it counts as talking.</p>
        </div>
        <div className="grid grid-cols-4 gap-5">
          <Slider label="Threshold" value={vo.thresholdDb} min={-60} max={-10} step={1} format={(n) => `${n} dB`} onChange={(thresholdDb) => void setVoice({ thresholdDb })} />
          <Slider label="Starts after" value={vo.minSpeechSeconds} min={0.5} max={5} step={0.5} format={(n) => `${n}s`} onChange={(minSpeechSeconds) => void setVoice({ minSpeechSeconds })} />
          <Slider label="Ends after quiet" value={vo.silenceSeconds} min={1} max={15} step={1} format={(n) => `${n}s`} onChange={(silenceSeconds) => void setVoice({ silenceSeconds })} />
          <Slider label="Max per clip" value={vo.maxClipSeconds} min={10} max={Math.max(30, settings.capture.bufferSeconds - 10)} step={5} format={(n) => `${n}s`} onChange={(maxClipSeconds) => void setVoice({ maxClipSeconds })} />
        </div>
      </Section>

      <Section
        title="Watch the screen for moments"
        icon={<Eye size={16} />}
        desc="Describe in plain English what you want clipped: kills, goals, wins. Clutch watches for big changes on screen and loud moments on your PC, and only then asks the AI whether it matches your rules. Calm stretches cost nothing."
        right={<div className="flex items-center gap-3"><Badge tone="accent"><Sparkles size={11} /> Optional AI</Badge><Toggle size="lg" checked={v.enabled} onChange={(enabled) => void setVision({ enabled })} label={v.enabled ? 'On' : 'Off'} /></div>}
      >
        {/* Plain statement of what leaves the PC, and where to. */}
        <div className="card-2 p-3.5 text-sm flex items-start gap-3">
          <Eye size={16} className="text-ink-3 mt-0.5 shrink-0" />
          <span className="flex-1 text-ink-2 leading-relaxed">
            {hasKey
              ? 'While this is on, small screenshots of your game (about 1024 px wide) are sent to Anthropic with your own API key, only at the moments Clutch flags. Nothing is sent while it is off.'
              : viaAccount
                ? `While this is on, small screenshots of your game are sent through your Clutch account to Anthropic, only at the moments Clutch flags${visionLimit ? `, up to ${visionLimit} checks a day` : ''}. They are not stored. Nothing is sent while it is off.`
                : 'This uses AI in the cloud, so it needs a Clutch account (free daily checks) or your own Anthropic API key. Nothing is sent while it is off.'}
          </span>
          {!hasKey && !viaAccount && (
            <span className="flex gap-2 shrink-0">
              <button className="btn-sm" onClick={() => signIn('Sign in to use screen watching with your free daily checks.')}>Sign in</button>
              <button className="btn-sm" onClick={() => setPage('settings')}>Add key</button>
            </span>
          )}
        </div>
        <Field label="Your rules">
          <textarea className="textarea min-h-28" value={v.rules} onChange={(e) => void setVision({ rules: e.target.value })} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-ink-3 self-center">Try:</span>
          {PRESETS.map((p) => <button key={p.name} className="chip h-7 px-2.5 hover:border-accent/60 hover:text-ink transition-colors" onClick={() => void setVision({ rules: p.text })}>{p.name}</button>)}
        </div>
        <div className="grid grid-cols-2 gap-5">
          <Slider label="Look every" value={v.intervalSeconds} min={2} max={15} step={1} format={(n) => `${n}s`} onChange={(intervalSeconds) => void setVision({ intervalSeconds })} hint={`Clutch looks this often on your PC, for free. The AI is only asked when something happens, at most ${v.maxPerMinute || 6} times a minute.`} />
          <Slider label="Minimum confidence" value={v.minConfidence} min={0.3} max={0.95} step={0.05} format={(n) => `${Math.round(n * 100)}%`} onChange={(minConfidence) => void setVision({ minConfidence })} hint="Raise it if you get clips of nothing; lower it if it misses moments." />
        </div>
        {v.enabled && status.running && (
          <p className="text-xs text-ink-3">
            Last check: {status.visionLastVerdict ?? 'waiting for something to happen'}
            {status.vision && ` · ${status.vision.checks} AI check${status.vision.checks === 1 ? '' : 's'}, ${status.vision.skipped} calm moment${status.vision.skipped === 1 ? '' : 's'} skipped for free`}
          </p>
        )}
      </Section>

      <Section title="Which games" icon={<Gamepad2 size={16} />} desc="Pick from what's running now or games you've already clipped. The hotkey always works.">
        <Field label="Treat as a game" hint="For games Clutch doesn't spot by itself, e.g. one running in a window. It records them like any other game and limits nothing else. Tip: right-click the tray icon right after playing for “Treat … as a game”.">
          <GamePicker value={settings.extraGames ?? []} onChange={(extraGames) => void save({ extraGames })} placeholder="Clutch finds your games by itself" />
        </Field>
        <div className="grid grid-cols-2 gap-5">
          <Field label="Never auto-clip in" hint="Discord, browsers, work apps…">
            <GamePicker value={settings.blocklist} onChange={(blocklist) => void save({ blocklist })} placeholder="No games blocked" />
          </Field>
          <Field label="Only auto-clip in" hint="Leave empty to allow every game. Games listed here are always treated as games for auto-start.">
            <GamePicker value={settings.allowlist} onChange={(allowlist) => void save({ allowlist })} placeholder="Every game allowed" />
          </Field>
        </div>
      </Section>

      <Profiles />
    </div>
  )
}

/** Per-game capture overrides. */
function Profiles() {
  const { settings, save, game } = useStore()
  const [apps, setApps] = useState<RunningApp[]>([])
  const [clipped, setClipped] = useState<GameSummary[]>([])
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    void window.cf.system.runningApps().then(setApps)
    void window.cf.library.games().then(setClipped)
  }, [adding])
  if (!settings) return null
  const profiles = settings.profiles
  const setProfile = (key: string, p: GameProfile | null) => {
    const next = { ...profiles }
    if (p) next[key] = p
    else delete next[key]
    void save({ profiles: next })
  }
  const candidates = [
    ...(game?.isGame && !profiles[game.process] ? [{ key: game.process, name: game.name, icon: game.icon }] : []),
    ...apps.filter((a) => !profiles[a.process.toLowerCase()]).map((a) => ({ key: a.process.toLowerCase(), name: a.process, icon: a.icon })),
    ...clipped.filter((g) => g.process && !profiles[g.process]).map((g) => ({ key: g.process!, name: g.name, icon: g.icon }))
  ].filter((c, i, arr) => arr.findIndex((x) => x.key === c.key) === i)

  return (
    <Section
      title="Per-game profiles"
      icon={<SlidersHorizontal size={16} />}
      desc="Override frame rate, quality or clip length for specific games. Recording restarts with the profile when that game comes to the front."
      right={!adding && <button className="btn" onClick={() => setAdding(true)}><Plus size={15} /> Add profile</button>}
    >
      {adding && (
        <div className="card-2 p-3 flex items-center gap-3">
          <select className="input flex-1" defaultValue="" onChange={(e) => { const c = candidates.find((x) => x.key === e.target.value); if (c) { setProfile(c.key, { name: c.name }); setAdding(false) } }}>
            <option value="">Choose a game…</option>
            {candidates.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
          <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
      {Object.keys(profiles).length === 0 && !adding && <p className="text-sm text-ink-3">No profiles. Every game uses the capture settings from Settings.</p>}
      <div className="space-y-3">
        {Object.entries(profiles).map(([key, p]) => {
          const icon = apps.find((a) => a.process.toLowerCase() === key)?.icon ?? clipped.find((g) => g.process === key)?.icon
          const set = (patch: Partial<GameProfile>) => setProfile(key, { ...p, ...patch })
          return (
            <div key={key} className="card-2 p-4 space-y-4">
              <div className="flex items-center gap-3">
                <GameIcon src={icon ? fileUrl(icon) : undefined} name={p.name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-ink-3">{key}.exe{game?.process === key ? ' · in front now' : ''}</div>
                </div>
                <button className="btn-ghost text-ink-3 hover:text-bad h-9 w-9 px-0" onClick={() => setProfile(key, null)} aria-label="Remove profile"><Trash2 size={15} /></button>
              </div>
              <div className="grid grid-cols-4 gap-4">
                <Field label="Frame rate">
                  <Segmented value={p.fps ?? 0} onChange={(fps) => set({ fps: fps === 0 ? undefined : (fps as 30 | 60 | 120 | 144) })} options={[{ value: 0, label: 'Default' }, { value: 60, label: '60' }, { value: 120, label: '120' }, { value: 144, label: '144' }]} />
                </Field>
                <Field label="Resolution">
                  <Segmented value={p.resolutionScale ?? 0} onChange={(r) => set({ resolutionScale: r === 0 ? undefined : (r as 1 | 0.75 | 0.5) })} options={[{ value: 0, label: 'Default' }, { value: 1, label: '100%' }, { value: 0.75, label: '75%' }, { value: 0.5, label: '50%' }]} />
                </Field>
                <Slider label="Quality (CQ)" value={p.quality ?? settings.capture.quality} min={15} max={35} onChange={(quality) => set({ quality })} format={(n) => (p.quality === undefined ? `default (${n})` : String(n))} />
                <Slider label="Clip back" value={p.preSeconds ?? settings.capture.preSeconds} min={5} max={Math.min(300, settings.capture.bufferSeconds)} step={5} onChange={(preSeconds) => set({ preSeconds })} format={(n) => (p.preSeconds === undefined ? `default (${n}s)` : `${n}s`)} />
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}
