import { useEffect, useState } from 'react'
import { FolderOpen, KeyRound, Youtube } from 'lucide-react'
import type { CaptureSettings, Encoder } from '../../../shared/types'
import { useStore } from '../lib/store'
import { Field, Section, Toggle } from '../components/ui'

const ENCODER_LABEL: Record<Encoder, string> = {
  auto: 'Auto (best available)',
  h264_nvenc: 'NVIDIA NVENC H.264',
  hevc_nvenc: 'NVIDIA NVENC HEVC (smaller files)',
  av1_nvenc: 'NVIDIA NVENC AV1 (RTX 40+)',
  h264_amf: 'AMD AMF H.264',
  h264_qsv: 'Intel Quick Sync H.264',
  libx264: 'Software x264 (CPU heavy)'
}

const QUALITY_PRESETS = [
  { name: 'Max', q: 17, hint: 'Huge files, visually lossless' },
  { name: 'High', q: 21, hint: 'YouTube-ready' },
  { name: 'Balanced', q: 25, hint: 'Default-ish, small files' },
  { name: 'Low', q: 30, hint: 'Tiny files for sharing' }
]

export default function Settings() {
  const { settings, save, status } = useStore()
  const [devices, setDevices] = useState<string[]>([])
  const [encoders, setEncoders] = useState<{ available: string[]; best: string } | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [yt, setYt] = useState<{ clientId: string; clientSecret: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    void window.cf.system.audioDevices().then(setDevices)
    void window.cf.system.encoders().then(setEncoders)
  }, [])
  if (!settings) return null
  const c = settings.capture
  const setCap = (patch: Partial<CaptureSettings>) => save({ capture: { ...c, ...patch } })
  const ytCfg = yt ?? { clientId: settings.upload.youtube.clientId, clientSecret: settings.upload.youtube.clientSecret }

  const connectYouTube = async () => {
    setBusy('yt'); setErr('')
    try {
      await save({ upload: { ...settings.upload, youtube: { ...settings.upload.youtube, ...ytCfg } } })
      await window.cf.youtube.connect()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted text-sm mt-1">{status.running ? 'Capture changes apply the next time you start the buffer.' : 'Pick quality, audio and accounts.'}</p>
      </header>

      <Section title="Video quality" desc={encoders ? `Working encoders on this PC: ${encoders.available.join(', ')}` : 'Detecting encoders…'}>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Frame rate">
            <div className="flex rounded-lg border border-line overflow-hidden">
              {([30, 60, 120, 144] as const).map((f) => (
                <button key={f} onClick={() => void setCap({ fps: f })} className={`flex-1 py-2 text-sm cursor-pointer ${c.fps === f ? 'bg-accent/20' : 'text-muted hover:text-ink'}`}>{f}</button>
              ))}
            </div>
          </Field>
          <Field label="Resolution">
            <div className="flex rounded-lg border border-line overflow-hidden">
              {([1, 0.75, 0.5] as const).map((s) => (
                <button key={s} onClick={() => void setCap({ resolutionScale: s })} className={`flex-1 py-2 text-sm cursor-pointer ${c.resolutionScale === s ? 'bg-accent/20' : 'text-muted hover:text-ink'}`}>{s === 1 ? 'Native' : `${s * 100}%`}</button>
              ))}
            </div>
          </Field>
          <Field label="Encoder">
            <select className="input" value={c.encoder} onChange={(e) => void setCap({ encoder: e.target.value as Encoder })}>
              {(Object.keys(ENCODER_LABEL) as Encoder[]).filter((e) => e === 'auto' || !encoders || encoders.available.includes(e)).map((e) => <option key={e} value={e}>{ENCODER_LABEL[e]}</option>)}
            </select>
          </Field>
        </div>
        <Field label={`Quality (CQ ${c.quality})`} hint="Constant quality: lower number = better picture and bigger files.">
          <div className="flex items-center gap-3">
            <input type="range" min={15} max={35} value={c.quality} className="flex-1" onChange={(e) => void setCap({ quality: Number(e.target.value) })} />
            {QUALITY_PRESETS.map((p) => <button key={p.name} title={p.hint} className={`chip cursor-pointer ${c.quality === p.q ? 'border-accent text-ink' : ''}`} onClick={() => void setCap({ quality: p.q })}>{p.name}</button>)}
          </div>
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label={`Keep the last ${c.bufferSeconds}s`} hint="Longer buffers let you clip further back; disk use grows with it.">
            <input type="range" min={30} max={600} step={30} value={c.bufferSeconds} className="w-full" onChange={(e) => void setCap({ bufferSeconds: Number(e.target.value) })} />
          </Field>
          <Field label={`Hotkey clips ${c.preSeconds}s back`}>
            <input type="range" min={5} max={Math.min(300, c.bufferSeconds)} step={5} value={c.preSeconds} className="w-full" onChange={(e) => void setCap({ preSeconds: Number(e.target.value) })} />
          </Field>
          <Field label={`…and ${c.postSeconds}s after`}>
            <input type="range" min={0} max={30} step={1} value={c.postSeconds} className="w-full" onChange={(e) => void setCap({ postSeconds: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Clip hotkey" hint="Electron accelerator, e.g. F8, Alt+F10, CommandOrControl+Shift+C">
            <input className="input" defaultValue={c.clipHotkey} onBlur={(e) => void setCap({ clipHotkey: e.target.value.trim() })} />
          </Field>
          <Field label="Monitor">
            <select className="input" value={c.monitorIndex} onChange={(e) => void setCap({ monitorIndex: Number(e.target.value) })}>
              {[0, 1, 2, 3].map((i) => <option key={i} value={i}>Monitor {i + 1}</option>)}
            </select>
          </Field>
          <Field label="Save clips to">
            <div className="flex gap-2">
              <input className="input" readOnly value={c.outputDir} />
              <button className="btn" onClick={() => void window.cf.settings.pickFolder().then((d) => { if (d) void setCap({ outputDir: d }) })}><FolderOpen size={16} /></button>
            </div>
          </Field>
        </div>
        <Toggle checked={settings.startBufferOnLaunch} onChange={(v) => void save({ startBufferOnLaunch: v })} label="Start recording when ClipForge opens" />
      </Section>

      <Section title="Audio">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Microphone" hint="Recorded on its own track input and used for the “when I talk” trigger.">
            <select className="input" value={c.micDevice} onChange={(e) => void setCap({ micDevice: e.target.value })}>
              <option value="">Off</option>
              {devices.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <div className="pt-6">
            <Toggle checked={c.systemAudio} onChange={(systemAudio) => void setCap({ systemAudio })} label="Game & voice-chat audio (system audio)" hint="Captured through Windows loopback. Needed for the “when friends talk” trigger." />
          </div>
        </div>
      </Section>

      <Section title="AI" desc="Powers the “watch the screen for moments” trigger. Your key stays on this PC.">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <Field label="Anthropic API key" hint="console.anthropic.com → API keys. Screenshots are sent only while the vision trigger is on.">
              <div className="flex gap-2">
                <input className="input" type="password" placeholder="sk-ant-…" value={key ?? settings.ai.anthropicApiKey} onChange={(e) => setKey(e.target.value)} />
                <button className="btn" onClick={() => { void save({ ai: { ...settings.ai, anthropicApiKey: (key ?? settings.ai.anthropicApiKey).trim() } }); setKey(null) }}><KeyRound size={16} /> Save</button>
              </div>
            </Field>
          </div>
          <Field label="Model">
            <select className="input" value={settings.ai.model} onChange={(e) => void save({ ai: { ...settings.ai, model: e.target.value } })}>
              <option value="claude-opus-5-5">Claude Opus 5.5 (default)</option>
              <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (cheaper)</option>
              <option value="claude-haiku-5-5">Claude Haiku 5.5 (cheapest)</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Accounts" desc="Uploads use your own Google OAuth app so your channel talks straight to YouTube.">
        {settings.upload.youtube.connected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm"><Youtube size={18} className="text-bad" /> Connected as <b>{settings.upload.youtube.channelTitle}</b></div>
            <button className="btn-danger" onClick={() => void window.cf.youtube.disconnect()}>Disconnect</button>
          </div>
        ) : (
          <div className="space-y-3">
            <ol className="text-xs text-muted list-decimal pl-4 space-y-1">
              <li>Go to console.cloud.google.com → create a project → enable “YouTube Data API v3”.</li>
              <li>APIs & Services → Credentials → Create OAuth client ID → type <b>Desktop app</b>.</li>
              <li>Paste the client ID and secret here, then Connect. Google opens in your browser.</li>
            </ol>
            <div className="grid grid-cols-2 gap-3">
              <input className="input" placeholder="Client ID" value={ytCfg.clientId} onChange={(e) => setYt({ ...ytCfg, clientId: e.target.value })} />
              <input className="input" type="password" placeholder="Client secret" value={ytCfg.clientSecret} onChange={(e) => setYt({ ...ytCfg, clientSecret: e.target.value })} />
            </div>
            <div className="flex items-center gap-3">
              <button className="btn-primary" disabled={busy === 'yt' || !ytCfg.clientId || !ytCfg.clientSecret} onClick={() => void connectYouTube()}><Youtube size={16} /> {busy === 'yt' ? 'Waiting for Google…' : 'Connect YouTube'}</button>
              {err && <span className="text-sm text-bad">{err}</span>}
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-4 pt-2">
          <Field label="Default privacy">
            <select className="input" value={settings.upload.youtube.privacy} onChange={(e) => void save({ upload: { ...settings.upload, youtube: { ...settings.upload.youtube, privacy: e.target.value as 'private' | 'unlisted' | 'public' } } })}>
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="public">Public</option>
            </select>
          </Field>
          <Field label="Title template" hint="{game} {title} {event} {date}">
            <input className="input" defaultValue={settings.upload.youtube.titleTemplate} onBlur={(e) => void save({ upload: { ...settings.upload, youtube: { ...settings.upload.youtube, titleTemplate: e.target.value } } })} />
          </Field>
          <Field label="Tags (comma separated)">
            <input className="input" defaultValue={settings.upload.youtube.tags.join(', ')} onBlur={(e) => void save({ upload: { ...settings.upload, youtube: { ...settings.upload.youtube, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) } } })} />
          </Field>
        </div>
      </Section>
    </div>
  )
}
