import { useEffect, useState } from 'react'
import { AlertTriangle, Bell, Palette, CheckCircle2, FolderOpen, Gauge, KeyRound, MessageSquare, Mic, Monitor, RefreshCw, Sparkles, Stethoscope, Trophy, Youtube, XCircle } from 'lucide-react'
import type { CaptureSettings, Encoder, HealthItem } from '../../../shared/types'
import { QUALITY_PRESETS } from '../../../shared/types'
import { startMeter } from '../lib/loopback'
import { useStore } from '../lib/store'
import { HotkeyInput } from '../components/HotkeyInput'
import { CaptureAreaSettings, StorageSettings } from '../components/CaptureAreaSettings'
import { AudioSources } from '../components/AudioSources'
import { AccountSection } from '../components/Account'
import { useToast } from '../components/Toasts'
import { Badge, Field, LevelMeter, Section, Segmented, Slider, Toggle } from '../components/ui'

const ENCODER_LABEL: Record<Encoder, string> = {
  auto: 'Auto (best available)',
  h264_nvenc: 'NVIDIA NVENC H.264',
  hevc_nvenc: 'NVIDIA NVENC HEVC (smaller files)',
  av1_nvenc: 'NVIDIA NVENC AV1 (RTX 40+)',
  h264_amf: 'AMD AMF H.264',
  h264_qsv: 'Intel Quick Sync H.264',
  libx264: 'Software x264 (CPU heavy)'
}

export default function Settings() {
  const { settings, save, status, setPage } = useStore()
  const toast = useToast()
  const [devices, setDevices] = useState<string[]>([])
  const [encoders, setEncoders] = useState<{ available: string[]; best: string } | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [yt, setYt] = useState<{ clientId: string; clientSecret: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [hotkeyStatus, setHotkeyStatus] = useState<'ok' | 'conflict' | 'unknown'>('unknown')

  useEffect(() => {
    void window.cf.system.audioDevices().then(setDevices)
    void window.cf.system.encoders().then(setEncoders)
  }, [])
  const hotkey = settings?.capture.clipHotkey ?? ''
  useEffect(() => { if (hotkey) void window.cf.system.testHotkey(hotkey).then((ok) => setHotkeyStatus(ok ? 'ok' : 'conflict')) }, [hotkey, status.hotkeyRegistered])

  if (!settings) return null
  const c = settings.capture
  const a = settings.app
  const setCap = (patch: Partial<CaptureSettings>) => save({ capture: { ...c, ...patch } })
  const setApp = (patch: Partial<typeof a>) => save({ app: { ...a, ...patch } })
  const ytCfg = yt ?? { clientId: settings.upload.youtube.clientId, clientSecret: settings.upload.youtube.clientSecret }
  const preset = QUALITY_PRESETS.find((p) => Object.entries(p.capture).every(([k, v]) => (c as unknown as Record<string, unknown>)[k] === v))?.id

  const connectYouTube = async () => {
    setBusy('yt'); setErr('')
    try {
      await save({ upload: { ...settings.upload, youtube: { ...settings.upload.youtube, ...ytCfg } } })
      const r = await window.cf.youtube.connect()
      toast.push({ kind: 'success', title: 'YouTube connected', body: r.channelTitle })
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-ink-3 text-sm mt-1">{status.running ? 'Capture changes apply the next time recording starts.' : 'Quality, audio, notifications and accounts.'}</p>
      </header>

      <AccountSection />

      <Health onFix={setPage} />

      <CaptureAreaSettings />

      <StorageSettings />

      <Section title="Quality" icon={<Gauge size={16} />} desc={encoders ? `Working encoders on this PC: ${encoders.available.join(', ')}` : 'Detecting encoders…'} right={<button className="btn-ghost text-sm" onClick={() => setAdvanced(!advanced)}>{advanced ? 'Hide advanced' : 'Advanced'}</button>}>
        <div className="grid grid-cols-4 gap-3">
          {QUALITY_PRESETS.map((p) => (
            <button key={p.id} onClick={() => void setCap(p.capture)} className={`card-2 p-3 text-left transition-all hover:border-line-strong ${preset === p.id ? 'border-accent shadow-[var(--shadow-glow)]' : ''}`}>
              <div className="font-semibold text-sm">{p.name}</div>
              <div className="text-xs text-ink-3 mt-1 leading-relaxed">{p.desc}</div>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-5">
          <Field label="Frame rate">
            <Segmented value={c.fps} onChange={(fps) => void setCap({ fps })} options={[30, 60, 120, 144].map((f) => ({ value: f as 30 | 60 | 120 | 144, label: String(f) }))} ariaLabel="Frame rate" />
          </Field>
          <Field label="Resolution">
            <Segmented value={c.resolutionScale} onChange={(resolutionScale) => void setCap({ resolutionScale })} options={[{ value: 1 as const, label: 'Native' }, { value: 0.75 as const, label: '75%' }, { value: 0.5 as const, label: '50%' }]} ariaLabel="Resolution" />
          </Field>
          <Slider label="Quality (CQ)" value={c.quality} min={15} max={35} onChange={(quality) => void setCap({ quality })} format={(n) => (n <= 19 ? `${n} · max` : n <= 23 ? `${n} · high` : n <= 27 ? `${n} · balanced` : `${n} · small`)} hint="Lower = better picture and bigger files." />
        </div>
        <div className="grid grid-cols-3 gap-5">
          <Slider label="Keep the last" value={c.bufferSeconds} min={30} max={600} step={30} format={(n) => `${n}s`} onChange={(bufferSeconds) => void setCap({ bufferSeconds, preSeconds: Math.min(c.preSeconds, bufferSeconds) })} hint="How far back you can clip. Disk use grows with it." />
          <Slider label="Hotkey clips back" value={c.preSeconds} min={5} max={Math.min(300, c.bufferSeconds)} step={5} format={(n) => `${n}s`} onChange={(preSeconds) => void setCap({ preSeconds })} />
          <Slider label="…and after" value={c.postSeconds} min={0} max={30} step={1} format={(n) => `${n}s`} onChange={(postSeconds) => void setCap({ postSeconds })} />
        </div>
        {advanced && (
          <div className="grid grid-cols-3 gap-5 pt-2 border-t border-line fade-in">
            <Field label="Encoder">
              <select className="input" value={c.encoder} onChange={(e) => void setCap({ encoder: e.target.value as Encoder })}>
                {(Object.keys(ENCODER_LABEL) as Encoder[]).filter((e) => e === 'auto' || !encoders || encoders.available.includes(e)).map((e) => <option key={e} value={e}>{ENCODER_LABEL[e]}</option>)}
              </select>
            </Field>
          </div>
        )}
      </Section>

      <Section title="Hotkey & game detection" icon={<Monitor size={16} />}>
        <div className="grid grid-cols-2 gap-5">
          <div className="space-y-5">
            <Field label="Clip hotkey" hint={`Saves the last ${c.preSeconds}s plus ${c.postSeconds}s after. Letters need a modifier so they don't fire while you type in chat.`}>
              <HotkeyInput value={c.clipHotkey} onChange={(clipHotkey) => void setCap({ clipHotkey })} status={hotkeyStatus} />
            </Field>
            <InGameLength />
            <div className="card-2 p-4 space-y-3">
              <div>
                <div className="text-sm font-semibold">Long recording & bookmarks</div>
                <p className="text-xs text-ink-3 mt-0.5 leading-relaxed">Record a whole session, like NVIDIA's Record. Press the bookmark key whenever something happens; later, open the recording and turn each bookmark into a clip with one click.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start / stop">
                  <HotkeyInput compact value={c.longRecordHotkey} onChange={(longRecordHotkey) => void setCap({ longRecordHotkey })} />
                </Field>
                <Field label="Bookmark">
                  <HotkeyInput compact value={c.bookmarkHotkey} onChange={(bookmarkHotkey) => void setCap({ bookmarkHotkey })} />
                </Field>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <Toggle checked={a.autoStart === 'games'} onChange={(on) => void setApp({ autoStart: on ? 'games' : 'off' })} label="Start recording when a game opens" hint="Games are detected by their install folder (Steam, Epic, Xbox…) or a fullscreen window." />
            {a.autoStart === 'games' && (
              <Slider label="Stop after the game closes" value={a.autoStopMinutes} min={0} max={30} step={1} format={(n) => (n === 0 ? 'never' : `${n} min`)} onChange={(autoStopMinutes) => void setApp({ autoStopMinutes })} />
            )}
            <Toggle checked={settings.startBufferOnLaunch} onChange={(v) => void save({ startBufferOnLaunch: v })} label="Start recording when Clutch opens" />
          </div>
        </div>
      </Section>

      <AudioSources />

      <Appearance />

      <Section title="Notifications & window" icon={<Bell size={16} />}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <div className="flex items-start gap-2">
            <Toggle checked={a.overlayToasts} onChange={(overlayToasts) => void setApp({ overlayToasts })} label="On-screen “Clipped!” popup" hint="Small corner toast over your game, like Medal. Exclusive-fullscreen games may hide it." />
            <button className="btn-sm ml-auto shrink-0" onClick={() => void window.cf.system.testOverlay()}>Test</button>
          </div>
          <Toggle checked={a.clipSound} onChange={(clipSound) => void setApp({ clipSound })} label="Play a chime when a clip is saved" />
          <Toggle checked={a.miniWidget} onChange={(miniWidget) => void setApp({ miniWidget })} label="Shrink to a mini controller while recording" hint="Clutch tucks away and a small panel with pause and stop sits in the corner. Only you see it; it never shows up in clips. Double-click it to check the recording." />
          <Toggle checked={a.minimizeToTray} onChange={(minimizeToTray) => void setApp({ minimizeToTray })} label="Keep running in the tray when closed" hint="Recording and hotkeys keep working. Quit from the tray icon." />
          <Toggle checked={a.startMinimized} onChange={(startMinimized) => void setApp({ startMinimized })} label="Start minimized to the tray" />
          <StartWithWindows />
          <Toggle checked={a.useTrash} onChange={(useTrash) => void setApp({ useTrash })} label="Keep deleted clips in the trash for 30 days" hint="Lets you undo a delete." />
        </div>
      </Section>

      <DiscordSettings />

      <Section title="AI" icon={<KeyRound size={16} />} desc="Everything in Clutch works without AI. Add a key to unlock screen watching and auto-titles. Your key stays on this PC." right={<Badge tone="accent"><Sparkles size={11} /> Optional</Badge>}>
        <div className="grid grid-cols-3 gap-5">
          <div className="col-span-2">
            <Field label="Anthropic API key" hint="console.anthropic.com → API keys. Screenshots are only sent while the trigger is on.">
              <div className="flex gap-2">
                <input className="input" type="password" placeholder="sk-ant-…" value={key ?? settings.ai.anthropicApiKey} onChange={(e) => setKey(e.target.value)} />
                <button className="btn" disabled={key === null} onClick={() => { void save({ ai: { ...settings.ai, anthropicApiKey: (key ?? '').trim() } }); setKey(null); toast.push({ kind: 'success', title: 'API key saved' }) }}>Save</button>
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
        <Toggle checked={settings.ai.autoTitle} onChange={(autoTitle) => void save({ ai: { ...settings.ai, autoTitle } })} label="Name new clips automatically" hint="One small request per clip using its thumbnail, e.g. “Triple kill on B site”. Never overwrites a name you typed." />
      </Section>

      <Section title="Accounts" icon={<Youtube size={16} />} desc="Uploads use your own Google OAuth app, so your channel talks straight to YouTube.">
        {settings.upload.youtube.connected ? (
          <div className="flex items-center justify-between card-2 p-3">
            <div className="flex items-center gap-3 text-sm"><span className="w-9 h-9 rounded-lg bg-[#ff0000]/15 text-[#ff4d4d] grid place-items-center"><Youtube size={18} /></span><div><div className="font-semibold">{settings.upload.youtube.channelTitle}</div><div className="text-xs text-ink-3">Connected</div></div></div>
            <button className="btn-danger" onClick={() => void window.cf.youtube.disconnect()}>Disconnect</button>
          </div>
        ) : (
          <div className="space-y-3">
            <ol className="text-xs text-ink-2 list-decimal pl-4 space-y-1 leading-relaxed">
              <li>Go to <button className="text-live hover:underline" onClick={() => void window.cf.system.openExternal('https://console.cloud.google.com/apis/library/youtube.googleapis.com')}>console.cloud.google.com</button> → create a project → enable “YouTube Data API v3”.</li>
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
        <div className="grid grid-cols-3 gap-5 pt-2">
          <Field label="Default visibility">
            <select className="input" value={settings.upload.youtube.privacy} onChange={(e) => void save({ upload: { ...settings.upload, youtube: { ...settings.upload.youtube, privacy: e.target.value as 'private' | 'unlisted' | 'public' } } })}>
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="public">Public</option>
            </select>
          </Field>
          <Field label="Title template" hint="{game} {title} {event} {date}">
            <input className="input" defaultValue={settings.upload.youtube.titleTemplate} onBlur={(e) => void save({ upload: { ...settings.upload, youtube: { ...settings.upload.youtube, titleTemplate: e.target.value } } })} />
          </Field>
          <Field label="Default tags">
            <input className="input" defaultValue={settings.upload.youtube.tags.join(', ')} onBlur={(e) => void save({ upload: { ...settings.upload, youtube: { ...settings.upload.youtube, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) } } })} />
          </Field>
        </div>
      </Section>
    </div>
  )
}

function Health({ onFix }: { onFix: (p: 'settings' | 'rules' | 'uploads') => void }) {
  const { status, settings } = useStore()
  const [items, setItems] = useState<HealthItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => { setBusy(true); try { setItems(await window.cf.system.health()) } finally { setBusy(false) } }
  useEffect(() => { void run() }, [status.running, status.hotkeyRegistered, settings]) // eslint-disable-line react-hooks/exhaustive-deps
  const bad = items?.filter((i) => i.ok === false).length ?? 0
  return (
    <Section title="Health check" icon={<Stethoscope size={16} />} desc={items ? (bad ? `${bad} thing${bad > 1 ? 's' : ''} need attention.` : 'Everything needed for recording is in place.') : 'Checking…'} right={<button className="btn-ghost h-9 w-9 px-0" onClick={() => void run()} aria-label="Re-run"><RefreshCw size={15} className={busy ? 'animate-spin' : ''} /></button>}>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-2">
        {(items ?? []).map((h) => {
          const Icon = h.ok === true ? CheckCircle2 : h.ok === 'warn' ? AlertTriangle : XCircle
          const tone = h.ok === true ? 'text-ok' : h.ok === 'warn' ? 'text-warn' : 'text-bad'
          return (
            <li key={h.id} className="flex items-start gap-2.5 text-sm py-1">
              <Icon size={16} className={`${tone} mt-0.5 shrink-0`} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{h.label}</div>
                <div className="text-xs text-ink-3 leading-relaxed break-words">{h.detail}</div>
              </div>
              {h.ok !== true && h.fix && h.fix !== 'settings' && <button className="btn-sm" onClick={() => onFix(h.fix!)}>Fix</button>}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function DiscordSettings() {
  const { settings, save } = useStore()
  const toast = useToast()
  const [url, setUrl] = useState<string | null>(null)
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState('')
  if (!settings) return null
  const d = settings.discord
  const set = (patch: Partial<typeof d>) => save({ discord: { ...d, ...patch } })
  const value = url ?? d.webhookUrl

  const test = async () => {
    setBusy('test'); setCheck(null)
    try {
      const info = await window.cf.discord.check(value)
      setCheck({ ok: true, text: `Connected to webhook “${info.name}”.` })
      if (value !== d.webhookUrl) { await set({ webhookUrl: value.trim() }); setUrl(null) }
    } catch (e) {
      setCheck({ ok: false, text: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': Error: /, '') })
    } finally { setBusy('') }
  }
  const postToday = async () => {
    setBusy('today')
    try { const c = await window.cf.discord.postToday(); toast.push({ kind: 'success', title: 'Clip of the day posted', body: c.title }) }
    catch (e) { toast.push({ kind: 'error', title: 'Nothing posted', body: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': Error: /, '') }) }
    finally { setBusy('') }
  }

  return (
    <Section title="Discord" icon={<MessageSquare size={16} />} desc="Post clips straight into a channel, and let Clutch share your clip of the day. Uses a channel webhook: no bot, no login.">
      <div className="space-y-2">
        <Field label="Channel webhook URL" hint="In Discord: channel ⚙ Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.">
          <div className="flex gap-2">
            <input className="input" type="password" placeholder="https://discord.com/api/webhooks/…" value={value} onChange={(e) => { setUrl(e.target.value); setCheck(null) }} />
            <button className="btn" disabled={!value || busy === 'test'} onClick={() => void test()}>{busy === 'test' ? 'Checking…' : value === d.webhookUrl ? 'Test' : 'Save & test'}</button>
            {d.webhookUrl && <button className="btn-danger" onClick={() => { void set({ webhookUrl: '' }); setUrl(null); setCheck(null) }}>Remove</button>}
          </div>
        </Field>
        {check && <p className={`text-xs flex items-center gap-1.5 ${check.ok ? 'text-ok' : 'text-bad'}`}>{check.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {check.text} {check.ok && <span className="text-ink-3">(Testing posts nothing.)</span>}</p>}
      </div>
      <div className="grid grid-cols-3 gap-5">
        <Field label="Server upload limit" hint="Big or HEVC clips get a small H.264 copy that plays inline.">
          <Segmented value={d.maxMb} onChange={(maxMb) => void set({ maxMb })} options={[{ value: 10, label: '10 MB' }, { value: 50, label: '50 MB' }, { value: 100, label: '100 MB' }]} />
        </Field>
        <Field label="Mention (optional)" hint="Added to every post, e.g. @here or a role.">
          <input className="input" placeholder="@here" defaultValue={d.mention} onBlur={(e) => void set({ mention: e.target.value.trim() })} />
        </Field>
        <div />
      </div>
      <div className="card-2 p-4 flex items-start gap-4">
        <span className="w-9 h-9 rounded-lg bg-warn/15 text-warn grid place-items-center shrink-0"><Trophy size={17} /></span>
        <div className="flex-1 space-y-3">
          <Toggle checked={d.dailyDigest.enabled} onChange={(enabled) => void set({ dailyDigest: { ...d.dailyDigest, enabled } })} label="Post my clip of the day" hint="Each day, the best clip is picked from favorites, hype level, trigger and views (no AI) and posted to the channel. You also get a Windows notification at that time." />
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-2">Every day at</span>
            <input type="time" className="input w-36 h-9" value={d.dailyDigest.time} onChange={(e) => void set({ dailyDigest: { ...d.dailyDigest, time: e.target.value } })} aria-label="Daily post time" />
            <button className="btn-sm ml-auto" disabled={!d.webhookUrl || busy === 'today'} onClick={() => void postToday()}>{busy === 'today' ? 'Posting…' : "Post today's now"}</button>
          </div>
        </div>
      </div>
    </Section>
  )
}

function Appearance() {
  const { settings, save } = useStore()
  const [canAcrylic, setCanAcrylic] = useState<boolean | null>(null)
  useEffect(() => { void window.cf.system.canAcrylic().then(setCanAcrylic) }, [])
  if (!settings) return null
  const a = settings.app
  return (
    <Section title="Appearance" icon={<Palette size={16} />} desc="Liquid-glass panels with a light HUD layer. Effects only cost GPU while the window is open; in the tray they cost nothing.">
      <div className="grid grid-cols-2 gap-6">
        <Field label="Visual effects" hint={a.effects === 'full' ? 'Frosted glass, light rims and HUD details.' : 'Solid panels, no blur. Best for older GPUs or laptops on battery.'}>
          <Segmented value={a.effects} onChange={(effects) => void save({ app: { ...a, effects } })} options={[{ value: 'full' as const, label: 'Liquid glass' }, { value: 'lite' as const, label: 'Lite' }]} ariaLabel="Visual effects" />
        </Field>
        <div className="pt-6">
          <Toggle
            checked={a.windowGlass}
            onChange={(windowGlass) => void save({ app: { ...a, windowGlass } })}
            label="See-through window (Windows 11 acrylic)"
            hint={canAcrylic === false ? 'Needs Windows 11 22H2 or newer.' : 'Your desktop wallpaper shows through the window, frosted. Windows turns it solid while the window is inactive.'}
          />
        </div>
      </div>
    </Section>
  )
}

const fmtLen = (n: number) => (n >= 60 && n % 60 === 0 ? `${n / 60} min` : `${n}s`)

/** Change clip length without leaving the game: step hotkeys + extra hotkeys with their own lengths. */
function InGameLength() {
  const { settings, save, status } = useStore()
  const [state, setState] = useState<Record<string, 'ok' | 'conflict'>>({})
  const c = settings?.capture
  const keys = c ? [c.lengthUpHotkey, c.lengthDownHotkey, ...c.extraHotkeys.map((x) => x.key)].filter(Boolean) : []
  const sig = keys.join('|')
  useEffect(() => {
    let alive = true
    void Promise.all(keys.map(async (k) => [k, (await window.cf.system.testHotkey(k)) ? 'ok' : 'conflict'] as const)).then((r) => { if (alive) setState(Object.fromEntries(r)) })
    return () => { alive = false }
  }, [sig, status.hotkeyRegistered]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null
  const setCap = (patch: Partial<typeof c>) => save({ capture: { ...c, ...patch } })
  const presets = [...c.lengthPresets].sort((a, b) => a - b)
  const usable = presets.filter((n) => n <= c.bufferSeconds)
  const suggest = () => {
    const base = c.clipHotkey || 'F9'
    const used = new Set([c.clipHotkey, c.lengthUpHotkey, c.lengthDownHotkey, ...c.extraHotkeys.map((x) => x.key)])
    const key = ['Shift+', 'Ctrl+', 'Alt+'].map((m) => m + base.split('+').pop()).find((k) => !used.has(k)) ?? ''
    const seconds = usable.find((n) => n > c.preSeconds && !c.extraHotkeys.some((x) => x.seconds === n)) ?? usable[usable.length - 1] ?? 60
    return { key, seconds }
  }
  return (
    <div className="card-2 p-4 space-y-4">
      <div>
        <div className="text-sm font-semibold">Change clip length in game</div>
        <p className="text-xs text-ink-3 mt-0.5 leading-relaxed">Press these mid-game. The on-screen popup shows the new length, so you never have to tab out.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((n) => (
          <button
            key={n}
            disabled={n > c.bufferSeconds}
            title={n > c.bufferSeconds ? `Longer than your ${c.bufferSeconds}s buffer` : `Clip the last ${fmtLen(n)}`}
            onClick={() => void setCap({ preSeconds: n })}
            className={`chip h-8 px-3 font-hud text-[11px] transition-all disabled:opacity-35 ${c.preSeconds === n ? 'text-ink border-accent/60 shadow-[0_0_14px_-4px_rgba(79,227,255,0.8)]' : 'hover:text-ink'}`}
          >
            {fmtLen(n)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Shorter">
          <HotkeyInput compact value={c.lengthDownHotkey} onChange={(lengthDownHotkey) => void setCap({ lengthDownHotkey })} status={state[c.lengthDownHotkey]} />
        </Field>
        <Field label="Longer">
          <HotkeyInput compact value={c.lengthUpHotkey} onChange={(lengthUpHotkey) => void setCap({ lengthUpHotkey })} status={state[c.lengthUpHotkey]} />
        </Field>
      </div>
      <div className="space-y-2">
        <span className="label">Extra clip hotkeys</span>
        {c.extraHotkeys.length === 0 && <p className="text-xs text-ink-3">Give a second key its own length, e.g. Shift+{(c.clipHotkey || 'F9').split('+').pop()} for a 1-minute clip.</p>}
        {c.extraHotkeys.map((x, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <HotkeyInput compact value={x.key} onChange={(key) => void setCap({ extraHotkeys: c.extraHotkeys.map((y, j) => (j === i ? { ...y, key } : y)) })} status={state[x.key]} />
            </div>
            <select className="input w-28" value={x.seconds} aria-label="Clip length" onChange={(e) => void setCap({ extraHotkeys: c.extraHotkeys.map((y, j) => (j === i ? { ...y, seconds: Number(e.target.value) } : y)) })}>
              {[...new Set([...presets, x.seconds])].sort((a, b) => a - b).map((n) => <option key={n} value={n} disabled={n > c.bufferSeconds}>{fmtLen(n)}</option>)}
            </select>
            <button className="btn-icon" aria-label="Remove hotkey" onClick={() => void setCap({ extraHotkeys: c.extraHotkeys.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button className="btn-sm" onClick={() => void setCap({ extraHotkeys: [...c.extraHotkeys, suggest()] })}>+ Add a clip hotkey</button>
      </div>
      {presets.some((n) => n > c.bufferSeconds) && <p className="text-[11px] text-ink-3">Lengths over {c.bufferSeconds}s are greyed out. Raise “Keep the last” above to unlock them.</p>}
    </div>
  )
}

function StartWithWindows() {
  const { settings, save } = useStore()
  const [available, setAvailable] = useState<boolean | null>(null)
  useEffect(() => { void window.cf.system.canLaunchAtLogin().then(setAvailable) }, [])
  if (!settings) return null
  return (
    <Toggle
      checked={settings.app.launchAtLogin}
      onChange={(launchAtLogin) => void save({ app: { ...settings.app, launchAtLogin } })}
      label="Start with Windows"
      hint={available === false ? 'Takes effect in the installed app (npm run dist). Saved for then.' : 'Opens hidden in the tray when you sign in, like Medal, so it is ready before your first game.'}
    />
  )
}
