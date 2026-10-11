import { useEffect, useState } from 'react'
import { AlertCircle, Clapperboard, Eye, Gamepad2, Mic, UploadCloud, Zap, Film, ChevronRight, Activity, Flame, MessageSquare, Trophy, Send, Loader2 } from 'lucide-react'
import type { Clip, HealthItem } from '../../../shared/types'
import { fileUrl, fmtBytes, fmtDuration, timeAgo, useStore } from '../lib/store'
import { GameIcon, LevelMeter, Section, Badge, Kbd } from '../components/ui'
import { useToast } from '../components/Toasts'

export default function Dashboard() {
  const { status, activity, settings, libraryVersion, start, clipNow, setPage, openClip, game, loopbackError } = useStore()
  const [recent, setRecent] = useState<Clip[]>([])
  const [stats, setStats] = useState<{ count: number; bytes: number; seconds: number } | null>(null)
  const [health, setHealth] = useState<HealthItem[]>([])
  const [best, setBest] = useState<{ clip: Clip; score: number } | null>(null)
  const [posting, setPosting] = useState(false)
  const toast = useToast()
  useEffect(() => {
    void window.cf.library.query({ sort: 'newest' }).then((c) => setRecent(c.slice(0, 8)))
    void window.cf.library.stats().then(setStats)
    void window.cf.highlights.today().then(setBest)
  }, [libraryVersion])
  useEffect(() => { void window.cf.system.health().then(setHealth) }, [status.running, status.hotkeyRegistered, settings])
  if (!settings) return null

  const problems = health.filter((h) => h.ok === false)
  const kindIcon = { clip: Clapperboard, vision: Eye, voice: Mic, hype: Flame, upload: UploadCloud, error: AlertCircle, info: Zap, game: Gamepad2, discord: MessageSquare } as const
  const triggers = [
    { on: !!settings.capture.clipHotkey && status.hotkeyRegistered !== false, icon: Zap, label: 'Hotkey', desc: settings.capture.clipHotkey ? `${settings.capture.clipHotkey} · ${settings.capture.preSeconds}s back + ${settings.capture.postSeconds}s` : 'Not set', page: 'settings' as const },
    { on: settings.hype.enabled, icon: Flame, label: 'Hype moments', desc: settings.hype.enabled ? `Shouts & laughs · no AI` : 'Off', page: 'rules' as const },
    { on: settings.vision.enabled && !!(settings.ai.anthropicApiKey), icon: Eye, label: 'AI screen watch', desc: settings.vision.enabled ? (settings.ai.anthropicApiKey ? `Every ${settings.vision.intervalSeconds}s · ${status.visionLastVerdict ?? 'waiting'}` : 'Needs an API key') : 'Off', page: 'rules' as const },
    { on: settings.voice.enabled, icon: Mic, label: 'When people talk', desc: settings.voice.enabled ? (status.talking ? 'Talking now…' : [settings.voice.onMic && 'mic', settings.voice.onSystemAudio && 'voice chat'].filter(Boolean).join(' + ')) : 'Off', page: 'rules' as const }
  ]

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className={`card relative overflow-hidden p-6 ${status.running ? 'border-live/30' : ''}`}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: status.running ? 'radial-gradient(600px 200px at 10% 0%, rgba(34,211,238,0.12), transparent)' : 'radial-gradient(600px 200px at 10% 0%, rgba(139,108,255,0.14), transparent)' }} />
        <div className="relative flex items-center gap-6">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              {status.running ? <Badge tone="live"><span className="w-1.5 h-1.5 rounded-full bg-live pulse-dot" /> Recording</Badge> : <Badge>Idle</Badge>}
              {game && (
                <span className="flex items-center gap-1.5 text-sm text-ink-2 min-w-0">
                  <GameIcon src={game.icon ? fileUrl(game.icon) : undefined} name={game.name} size={18} />
                  <span className="truncate">{game.name}</span>
                </span>
              )}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {status.running ? `The last ${Math.min(status.bufferedSeconds ?? 0, settings.capture.bufferSeconds)} seconds are ready to clip.` : settings.app.autoStart === 'games' ? 'Open a game and recording starts by itself.' : 'Start recording, then clip the moments that matter.'}
            </h1>
            <p className="text-ink-2 mt-1.5 text-sm">
              {status.running
                ? `${status.resolution} at ${status.fps} fps · ${status.encoder} · keeping ${settings.capture.bufferSeconds}s`
                : status.lastError ? 'The last recording stopped with an error. Details below.' : `Hotkey ${settings.capture.clipHotkey || 'not set'} saves the previous ${settings.capture.preSeconds}s plus ${settings.capture.postSeconds}s after.`}
            </p>
            <div className="flex items-center gap-2 mt-5">
              {status.running ? (
                <button className="btn-live px-5" onClick={() => void clipNow()}><Zap size={16} /> Clip the last {settings.capture.preSeconds}s {settings.capture.clipHotkey && <Kbd>{settings.capture.clipHotkey}</Kbd>}</button>
              ) : (
                <button className="btn-primary px-5" disabled={status.starting} onClick={() => void start()}>{status.starting ? 'Starting…' : 'Start recording'}</button>
              )}
              <button className="btn" onClick={() => setPage('rules')}>What to clip</button>
            </div>
          </div>
          {stats && (
            <div className="hidden lg:grid grid-cols-3 gap-3 text-center shrink-0">
              {[[stats.count, 'clips'], [fmtDuration(stats.seconds), 'recorded'], [fmtBytes(stats.bytes), 'on disk']].map(([v, l]) => (
                <div key={String(l)} className="card-2 px-4 py-3 min-w-[96px]">
                  <div className="text-lg font-semibold tabular">{v}</div>
                  <div className="text-[11px] uppercase tracking-wide text-ink-3">{l}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {(status.lastError || loopbackError || problems.length > 0) && (
        <div className="space-y-2">
          {status.lastError && <Problem text={status.lastError} action={{ label: 'Try again', onClick: () => void start() }} />}
          {loopbackError && <Problem text={`System audio is not being captured: ${loopbackError}`} action={{ label: 'Audio settings', onClick: () => setPage('settings') }} />}
          {problems.map((p) => <Problem key={p.id} text={`${p.label}: ${p.detail}`} action={p.fix ? { label: 'Fix', onClick: () => setPage(p.fix!) } : undefined} />)}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        {triggers.map((t) => (
          <button key={t.label} onClick={() => setPage(t.page)} className={`card p-4 text-left transition-all hover:border-line-strong hover:-translate-y-px group ${t.on ? '' : 'opacity-70'}`}>
            <div className="flex items-center gap-2.5">
              <span className={`w-8 h-8 rounded-lg grid place-items-center ${t.on ? 'bg-accent/15 text-accent-2' : 'bg-surface-3 text-ink-3'}`}><t.icon size={16} /></span>
              <span className="font-semibold text-sm">{t.label}</span>
              <span className={`ml-auto w-2 h-2 rounded-full ${t.on ? 'bg-ok' : 'bg-ink-3/40'}`} />
            </div>
            <div className="text-xs text-ink-3 mt-2 truncate">{t.desc}</div>
          </button>
        ))}
      </div>

      {best && (
        <section className="card overflow-hidden flex fade-in">
          <button className="w-[300px] shrink-0 aspect-video bg-surface-3 relative group" onClick={() => openClip(best.clip.id)} aria-label={`Watch ${best.clip.title}`}>
            <img src={fileUrl(best.clip.thumbnail)} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
            <span className="absolute bottom-2 right-2 chip bg-black/70 border-0 text-white tabular">{fmtDuration(best.clip.durationSec)}</span>
          </button>
          <div className="flex-1 min-w-0 p-5 flex flex-col">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-warn"><Trophy size={14} /> Clip of the day</div>
            <div className="text-lg font-semibold mt-1.5 truncate">{best.clip.title}</div>
            <div className="text-sm text-ink-3 flex items-center gap-1.5 mt-0.5 min-w-0">
              <GameIcon src={best.clip.gameIcon ? fileUrl(best.clip.gameIcon) : undefined} name={best.clip.game} size={16} />
              <span className="truncate">{best.clip.game} · {timeAgo(best.clip.createdAt)}{best.clip.event ? ` · ${best.clip.event}` : ''}</span>
            </div>
            <p className="text-xs text-ink-3 mt-2 leading-relaxed">Picked from today's clips by favorites, hype level, how it was triggered and how often you watched it. {settings.discord.dailyDigest.enabled && settings.discord.webhookUrl ? `Posts to Discord at ${settings.discord.dailyDigest.time}.` : `You'll get a notification at ${settings.discord.dailyDigest.time}.`}</p>
            <div className="flex gap-2 mt-auto pt-3">
              <button className="btn" onClick={() => openClip(best.clip.id)}>Watch</button>
              {settings.discord.webhookUrl ? (
                <button className="btn bg-[#5865F2] border-[#5865F2] text-white hover:bg-[#4752c4] hover:border-[#4752c4]" disabled={posting} onClick={async () => {
                  setPosting(true)
                  try { await window.cf.discord.post(best.clip.id, { heading: '**Clip of the day**' }); toast.push({ kind: 'success', title: 'Clip of the day posted to Discord' }) }
                  catch (e) { toast.push({ kind: 'error', title: 'Discord post failed', body: String((e as Error)?.message ?? e) }) }
                  finally { setPosting(false) }
                }}>{posting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Share to Discord</button>
              ) : (
                <button className="btn" onClick={() => setPage('settings')}><MessageSquare size={15} /> Connect Discord</button>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-5 gap-5">
        <div className="col-span-3 space-y-5">
          <Section title="Recent clips" icon={<Film size={16} />} right={<button className="btn-ghost text-sm" onClick={() => setPage('library')}>All clips <ChevronRight size={14} /></button>}>
            {recent.length === 0 ? (
              <p className="text-sm text-ink-3">No clips yet. Start recording and press {settings.capture.clipHotkey || 'Clip now'} when something happens.</p>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                {recent.map((c) => (
                  <button key={c.id} onClick={() => openClip(c.id)} className="text-left group">
                    <div className="aspect-video rounded-lg overflow-hidden bg-surface-3 border border-line relative">
                      <img src={fileUrl(c.thumbnail)} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" loading="lazy" />
                      <span className="absolute bottom-1 right-1 chip bg-black/70 border-0 text-white tabular">{fmtDuration(c.durationSec)}</span>
                    </div>
                    <div className="text-[13px] font-medium mt-1.5 truncate">{c.title}</div>
                    <div className="text-xs text-ink-3 truncate">{c.game} · {timeAgo(c.createdAt)}</div>
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section title="Live audio" icon={<Activity size={16} />} desc={status.running ? undefined : 'Meters move while recording.'}>
            <div className="space-y-2.5">
              <LevelMeter label="Mic" db={status.running ? status.micLevelDb : undefined} threshold={settings.voice.enabled && settings.voice.onMic ? settings.voice.thresholdDb : undefined} />
              <LevelMeter label="System" db={status.running ? status.systemLevelDb : undefined} threshold={settings.voice.enabled && settings.voice.onSystemAudio ? settings.voice.thresholdDb : undefined} />
            </div>
          </Section>
        </div>

        <Section title="Activity" icon={<Activity size={16} />} className="col-span-2">
          <ul className="space-y-2.5 max-h-[560px] overflow-y-auto pr-1 -mr-1 text-sm">
            {activity.length === 0 && <li className="text-ink-3 text-sm">Nothing yet.</li>}
            {activity.slice(0, 60).map((ev, i) => {
              const Icon = kindIcon[ev.kind]
              const tone = ev.kind === 'error' ? 'text-bad' : ev.kind === 'clip' ? 'text-ok' : ev.kind === 'vision' ? 'text-live' : ev.kind === 'hype' ? 'text-warn' : ev.kind === 'discord' ? 'text-[#8b95ff]' : ev.kind === 'game' ? 'text-accent-2' : 'text-ink-3'
              return (
                <li key={i} className="flex gap-2.5">
                  <Icon size={14} className={`mt-1 shrink-0 ${tone}`} />
                  <div className="min-w-0">
                    {ev.clipId ? (
                      <button className="text-left break-words hover:text-accent-2" onClick={() => openClip(ev.clipId!)}>{ev.message}</button>
                    ) : (
                      <div className="break-words leading-snug">{ev.message}</div>
                    )}
                    <div className="text-[11px] text-ink-3 tabular">{new Date(ev.at).toLocaleTimeString()}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        </Section>
      </div>
    </div>
  )
}

function Problem({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="card p-3.5 border-bad/30 text-sm flex items-center gap-3 fade-in">
      <AlertCircle className="text-bad shrink-0" size={18} />
      <div className="flex-1 min-w-0 leading-snug">{text}</div>
      {action && <button className="btn-sm" onClick={action.onClick}>{action.label}</button>}
    </div>
  )
}
