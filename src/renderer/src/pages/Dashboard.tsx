import { useEffect, useState } from 'react'
import { AlertCircle, Clapperboard, Eye, Mic, UploadCloud, Zap } from 'lucide-react'
import type { Clip } from '../../../shared/types'
import { fileUrl, fmtDuration, timeAgo, useStore } from '../lib/store'
import { LevelMeter, Section } from '../components/ui'

export default function Dashboard({ onNavigate }: { onNavigate: (p: 'library' | 'rules' | 'settings' | 'uploads') => void }) {
  const { status, activity, settings, libraryVersion, start, clipNow } = useStore()
  const [recent, setRecent] = useState<Clip[]>([])
  useEffect(() => { void window.cf.library.query({ sort: 'newest' }).then((c) => setRecent(c.slice(0, 6))) }, [libraryVersion])
  if (!settings) return null

  const kindIcon = { clip: Clapperboard, vision: Eye, voice: Mic, upload: UploadCloud, error: AlertCircle, info: Zap } as const
  const triggers = [
    { on: true, label: `Hotkey ${settings.capture.clipHotkey}`, desc: `${settings.capture.preSeconds}s back + ${settings.capture.postSeconds}s` },
    { on: settings.vision.enabled && !!settings.ai.anthropicApiKey, label: 'Watch for moments', desc: settings.vision.enabled ? (settings.ai.anthropicApiKey ? `checks every ${settings.vision.intervalSeconds}s` : 'needs an API key') : 'off' },
    { on: settings.voice.enabled, label: 'When people talk', desc: settings.voice.enabled ? `${[settings.voice.onMic && 'mic', settings.voice.onSystemAudio && 'voice chat'].filter(Boolean).join(' + ')}` : 'off' }
  ]

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-muted text-sm mt-1">{status.running ? `Buffering the last ${settings.capture.bufferSeconds}s of ${status.game ?? 'your screen'}.` : 'Start the buffer, then clip with the hotkey or let the triggers do it.'}</p>
        </div>
        {!status.running && <button className="btn-primary" onClick={() => void start()}>Start recording</button>}
        {status.running && <button className="btn-primary" onClick={() => void clipNow()}>Clip the last {settings.capture.preSeconds}s</button>}
      </header>

      {status.lastError && (
        <div className="card p-4 border-bad/40 text-sm flex gap-3">
          <AlertCircle className="text-bad shrink-0" size={18} />
          <div><span className="font-medium">Capture problem.</span> {status.lastError}</div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {triggers.map((t) => (
          <button key={t.label} onClick={() => onNavigate('rules')} className={`card p-4 text-left hover:border-accent/50 transition-colors cursor-pointer ${t.on ? '' : 'opacity-60'}`}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${t.on ? 'bg-ok' : 'bg-muted/40'}`} />
              <span className="font-medium text-sm">{t.label}</span>
            </div>
            <div className="text-xs text-muted mt-1">{t.desc}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-3 space-y-6">
          <Section title="Recent clips" right={<button className="btn" onClick={() => onNavigate('library')}>All clips</button>}>
            {recent.length === 0 ? (
              <p className="text-sm text-muted">No clips yet. Press {settings.capture.clipHotkey} while the buffer is running.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {recent.map((c) => (
                  <button key={c.id} onClick={() => onNavigate('library')} className="text-left group cursor-pointer">
                    <div className="aspect-video rounded-lg overflow-hidden bg-panel-2 border border-line relative">
                      <img src={fileUrl(c.thumbnail)} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      <span className="absolute bottom-1 right-1 chip bg-black/60 border-0 text-white">{fmtDuration(c.durationSec)}</span>
                    </div>
                    <div className="text-sm mt-1.5 truncate">{c.title}</div>
                    <div className="text-xs text-muted">{c.game} · {timeAgo(c.createdAt)}</div>
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section title="Live" desc={status.running ? `${status.resolution ?? ''} ${status.fps ?? ''} fps · ${status.encoder ?? ''}` : 'Buffer stopped'}>
            <div className="space-y-2">
              <LevelMeter label="Mic" db={status.micLevelDb} />
              <LevelMeter label="System" db={status.systemLevelDb} />
            </div>
            {settings.vision.enabled && (
              <div className="text-xs text-muted">
                <Eye size={12} className="inline mr-1" />
                Last check: {status.visionLastVerdict ?? 'waiting for frames'} {status.visionLastCheck && `· ${timeAgo(status.visionLastCheck)}`}
              </div>
            )}
          </Section>
        </div>

        <Section title="Activity" desc="What the recorder is doing">
          <ul className="space-y-2 max-h-[520px] overflow-y-auto pr-1 text-sm">
            {activity.length === 0 && <li className="text-muted text-sm">Nothing yet.</li>}
            {activity.map((ev, i) => {
              const Icon = kindIcon[ev.kind]
              return (
                <li key={i} className="flex gap-2">
                  <Icon size={14} className={`mt-0.5 shrink-0 ${ev.kind === 'error' ? 'text-bad' : ev.kind === 'clip' ? 'text-ok' : ev.kind === 'vision' ? 'text-accent-2' : 'text-muted'}`} />
                  <div className="min-w-0">
                    <div className="break-words">{ev.message}</div>
                    <div className="text-[11px] text-muted">{new Date(ev.at).toLocaleTimeString()}</div>
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
