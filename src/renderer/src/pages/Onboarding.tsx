import { useEffect, useState } from 'react'
import { ArrowRight, Check, Gauge, Keyboard, Mic, Sparkles, Volume2 } from 'lucide-react'
import { QUALITY_PRESETS } from '../../../shared/types'
import { useStore } from '../lib/store'
import { startMeter } from '../lib/loopback'
import { HotkeyInput } from '../components/HotkeyInput'
import { LevelMeter, Toggle } from '../components/ui'

const STEPS = ['Welcome', 'Audio', 'Hotkey', 'Quality', 'Smart clips'] as const

/** First-run wizard: under a minute, every step verifiable on the spot. */
export default function Onboarding() {
  const { settings, save } = useStore()
  const [step, setStep] = useState(0)
  if (!settings) return null
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1))
  const finish = () => void save({ app: { ...settings.app, onboarded: true } })

  return (
    <div className="h-full flex flex-col">
      <div className="drag h-10 shrink-0" />
      <div className="flex-1 grid place-items-center p-8">
        <div className="w-full max-w-[720px]">
          <ol className="flex items-center gap-2 mb-8 text-xs">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className={`w-6 h-6 rounded-full grid place-items-center font-semibold transition-colors ${i < step ? 'bg-ok text-black' : i === step ? 'bg-accent text-white' : 'bg-surface-3 text-ink-3'}`}>{i < step ? <Check size={12} /> : i + 1}</span>
                <span className={i === step ? 'text-ink font-medium' : 'text-ink-3'}>{s}</span>
                {i < STEPS.length - 1 && <span className="w-6 h-px bg-line mx-1" />}
              </li>
            ))}
          </ol>

          <div className="card p-8 pop-in" key={step}>
            {step === 0 && <Welcome onNext={next} />}
            {step === 1 && <Audio onNext={next} />}
            {step === 2 && <Hotkey onNext={next} />}
            {step === 3 && <Quality onNext={next} />}
            {step === 4 && <Smart onFinish={finish} />}
          </div>
          {step > 0 && step < STEPS.length && (
            <div className="mt-3 flex justify-between text-xs text-ink-3">
              <button className="hover:text-ink" onClick={() => setStep((s) => s - 1)}>← Back</button>
              <button className="hover:text-ink" onClick={finish}>Skip setup</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-live grid place-items-center shadow-[var(--shadow-glow)] mb-5">
        <Sparkles className="text-white" size={28} />
      </div>
      <h1 className="text-2xl font-semibold">Welcome to Clutch</h1>
      <p className="text-ink-2 mt-2 leading-relaxed max-w-md mx-auto">
        It keeps the last few minutes of your game ready, so you can save a clip after the moment happens. Tell it what to look for and it clips for you.
      </p>
      <div className="grid grid-cols-3 gap-3 mt-6 text-left">
        {[
          ['Press a key', 'Save the last 20 seconds any time.'],
          ['Describe moments', '"Clip my kills, never menus." Claude watches.'],
          ['Voice chat', 'Save every funny conversation automatically.']
        ].map(([t, d]) => (
          <div key={t} className="card-2 p-3">
            <div className="text-sm font-semibold">{t}</div>
            <div className="text-xs text-ink-3 mt-1 leading-relaxed">{d}</div>
          </div>
        ))}
      </div>
      <button className="btn-primary mt-7 px-6" onClick={onNext}>Set up in a minute <ArrowRight size={16} /></button>
    </div>
  )
}

function Audio({ onNext }: { onNext: () => void }) {
  const { settings, save } = useStore()
  const [devices, setDevices] = useState<string[]>([])
  const [micDb, setMicDb] = useState<number>()
  const [sysDb, setSysDb] = useState<number>()
  const [sysErr, setSysErr] = useState('')
  const mic = settings!.capture.micDevice
  useEffect(() => { void window.cf.system.audioDevices().then((d) => { setDevices(d); if (!mic && d.length) void save({ capture: { ...settings!.capture, micDevice: d[0] } }) }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mic) { setMicDb(undefined); return }
    let stop: (() => void) | undefined
    startMeter('mic', setMicDb, mic).then((s) => (stop = s)).catch(() => setMicDb(undefined))
    return () => stop?.()
  }, [mic])
  useEffect(() => {
    if (!settings!.capture.systemAudio) return
    let stop: (() => void) | undefined
    startMeter('system', setSysDb).then((s) => (stop = s)).catch((e) => setSysErr(String(e?.message ?? e)))
    return () => stop?.()
  }, [settings!.capture.systemAudio]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <StepHeader icon={<Mic size={20} />} title="Audio" desc="Say something and play a sound. Both meters should move." />
      <div className="space-y-5 mt-6">
        <div>
          <span className="label">Microphone</span>
          <select className="input" value={mic} onChange={(e) => void save({ capture: { ...settings!.capture, micDevice: e.target.value } })}>
            <option value="">No microphone</option>
            {devices.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <div className="mt-3"><LevelMeter label="Mic" db={micDb} /></div>
        </div>
        <div>
          <Toggle checked={settings!.capture.systemAudio} onChange={(systemAudio) => void save({ capture: { ...settings!.capture, systemAudio } })} label="Game and voice-chat audio" hint="Everything you hear, captured through Windows." />
          <div className="mt-3"><LevelMeter label="System" db={settings!.capture.systemAudio ? sysDb : undefined} /></div>
          {sysErr && <p className="text-xs text-bad mt-2">System audio could not start: {sysErr}</p>}
        </div>
      </div>
      <div className="flex justify-end mt-7"><button className="btn-primary px-6" onClick={onNext}>Continue <ArrowRight size={16} /></button></div>
    </div>
  )
}

function Hotkey({ onNext }: { onNext: () => void }) {
  const { settings, save } = useStore()
  const [status, setStatus] = useState<'ok' | 'conflict' | 'unknown'>('unknown')
  const key = settings!.capture.clipHotkey
  useEffect(() => { if (key) void window.cf.system.testHotkey(key).then((ok) => setStatus(ok ? 'ok' : 'conflict')) }, [key])
  return (
    <div>
      <StepHeader icon={<Keyboard size={20} />} title="Clip hotkey" desc="Press it mid-game to save what just happened. F-keys work best; letters need a modifier." />
      <div className="mt-6">
        <HotkeyInput value={key} onChange={(clipHotkey) => void save({ capture: { ...settings!.capture, clipHotkey } })} status={status} />
        {status === 'conflict' && <p className="text-xs text-warn mt-2">Another app (Medal uses F8) already owns this key. Pick a different one.</p>}
      </div>
      <div className="flex justify-end mt-7"><button className="btn-primary px-6" onClick={onNext}>Continue <ArrowRight size={16} /></button></div>
    </div>
  )
}

function Quality({ onNext }: { onNext: () => void }) {
  const { settings, save } = useStore()
  const [encoders, setEncoders] = useState<{ available: string[]; best: string } | null>(null)
  useEffect(() => { void window.cf.system.encoders().then(setEncoders) }, [])
  const current = QUALITY_PRESETS.find((p) => Object.entries(p.capture).every(([k, v]) => (settings!.capture as unknown as Record<string, unknown>)[k] === v))?.id
  return (
    <div>
      <StepHeader icon={<Gauge size={20} />} title="Quality" desc={encoders ? (encoders.best === 'libx264' ? 'No GPU encoder found, recording will use your CPU.' : `Your GPU encoder (${encoders.best}) will do the work, so the game stays smooth.`) : 'Checking your GPU…'} />
      <div className="grid grid-cols-2 gap-3 mt-6">
        {QUALITY_PRESETS.map((p) => (
          <button key={p.id} onClick={() => void save({ capture: { ...settings!.capture, ...p.capture } })} className={`card-2 p-4 text-left transition-all hover:border-line-strong ${current === p.id ? 'border-accent shadow-[var(--shadow-glow)]' : ''}`}>
            <div className="font-semibold text-sm flex items-center gap-2">{p.name}{current === p.id && <Check size={14} className="text-accent-2" />}</div>
            <div className="text-xs text-ink-3 mt-1 leading-relaxed">{p.desc}</div>
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-3 mt-4">You can fine-tune frame rate, resolution and the encoder later under Settings.</p>
      <div className="flex justify-end mt-6"><button className="btn-primary px-6" onClick={onNext}>Continue <ArrowRight size={16} /></button></div>
    </div>
  )
}

function Smart({ onFinish }: { onFinish: () => void }) {
  const { settings, save } = useStore()
  const [key, setKey] = useState('')
  const s = settings!
  return (
    <div>
      <StepHeader icon={<Sparkles size={20} />} title="Smart clips" desc="Optional. Both can be changed any time under “What to clip”." />
      <div className="space-y-5 mt-6">
        <Toggle size="lg" checked={s.voice.enabled} onChange={(enabled) => void save({ voice: { ...s.voice, enabled } })} label="Clip when people talk" hint="Saves a clip of every stretch of conversation on your mic or in voice chat." />
        <div>
          <Toggle size="lg" checked={s.vision.enabled} onChange={(enabled) => void save({ vision: { ...s.vision, enabled } })} label="Watch the screen for moments" hint="Claude looks at a screenshot every few seconds and clips kills, goals and whatever you describe. Needs an Anthropic API key." />
          {s.vision.enabled && !s.ai.anthropicApiKey && (
            <div className="flex gap-2 mt-3 ml-[52px]">
              <input className="input" type="password" placeholder="Paste your Anthropic API key (sk-ant-…)" value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="btn" onClick={() => void save({ ai: { ...s.ai, anthropicApiKey: key.trim() } })} disabled={!key.trim()}>Save</button>
            </div>
          )}
        </div>
        <Toggle checked={s.app.autoStart === 'games'} onChange={(on) => void save({ app: { ...s.app, autoStart: on ? 'games' : 'off' } })} label="Start recording automatically when a game opens" hint="Detects games by their install folder or fullscreen window. Stops a few minutes after you quit." />
      </div>
      <div className="flex items-center justify-between mt-7">
        <span className="text-xs text-ink-3 flex items-center gap-1"><Volume2 size={12} /> A short chime and an on-screen “Clipped!” confirm every save.</span>
        <button className="btn-primary px-6" onClick={onFinish}>Finish <Check size={16} /></button>
      </div>
    </div>
  )
}

function StepHeader({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-11 h-11 rounded-xl bg-surface-3 border border-line grid place-items-center text-accent-2 shrink-0">{icon}</div>
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-ink-2 mt-1 leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}
