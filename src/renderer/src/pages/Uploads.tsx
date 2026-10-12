import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, Clock, Loader2, Plus, UploadCloud, X, XCircle, Youtube } from 'lucide-react'
import type { Clip, UploadRecord } from '../../../shared/types'
import { dayLabel, fileUrl, timeAgo, useStore } from '../lib/store'
import { Empty, Field, Progress, Section, Toggle, Badge } from '../components/ui'

export default function Uploads() {
  const { settings, save, uploadsVersion, libraryVersion, setPage, openClip, account, signIn, setProOpen, goTo } = useStore()
  const [items, setItems] = useState<{ clip: Clip; upload: UploadRecord }[]>([])
  const [upNext, setUpNext] = useState<Clip | undefined>()
  const [newTime, setNewTime] = useState('18:00')
  useEffect(() => {
    void window.cf.upload.list().then(setItems)
    void window.cf.upload.next('youtube').then(setUpNext)
  }, [uploadsVersion, libraryVersion, settings?.upload.schedule])
  if (!settings) return null
  const sch = settings.upload.schedule
  const setSch = (patch: Partial<typeof sch>) => save({ upload: { ...settings.upload, schedule: { ...sch, ...patch } } })
  const yt = settings.upload.youtube

  const active = items.filter((i) => i.upload.status === 'queued' || i.upload.status === 'uploading')
  const history = items.filter((i) => i.upload.status === 'done' || i.upload.status === 'failed')
  const historyByDay = useMemo(() => {
    const m = new Map<string, typeof history>()
    for (const h of history) m.set(dayLabel(h.upload.scheduledAt), [...(m.get(dayLabel(h.upload.scheduledAt)) ?? []), h])
    return [...m.entries()]
  }, [history])

  const icon = { queued: Clock, uploading: Loader2, done: CheckCircle2, failed: XCircle } as const
  const tone = { queued: 'text-ink-3', uploading: 'text-live animate-spin', done: 'text-ok', failed: 'text-bad' } as const

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Uploads</h1>
          <p className="text-ink-3 text-sm mt-1">{yt.connected ? <>Connected to YouTube as <span className="text-ink">{yt.channelTitle}</span>.</> : 'Connect YouTube to upload clips straight from the app.'}</p>
        </div>
        {!yt.connected && <button className="btn-primary" onClick={() => goTo('settings', 'Accounts')}><Youtube size={16} /> Connect YouTube</button>}
      </header>

      <Section
        title="Auto-upload schedule"
        icon={<CalendarClock size={16} />}
        desc="At each time below, the oldest favorite (or tagged) clip that hasn't gone out yet is uploaded. Heart the clips you like and your channel stays fed."
        right={<Toggle checked={sch.enabled && account.signedIn} onChange={(enabled) => { if (!account.signedIn) { signIn('Auto-uploads run on a schedule from your Clutch account. Sign in to turn them on.'); return } void setSch({ enabled }) }} label={sch.enabled && account.signedIn ? 'On' : 'Off'} />}
      >
        {!account.signedIn && (
          <div className="card-2 p-3.5 flex items-center gap-3 text-sm">
            <span className="flex-1">Auto-uploads need a free Clutch account. Manual uploads from a clip’s Share tab work without one.</span>
            <button className="btn-primary h-9" onClick={() => signIn('Auto-uploads run on a schedule from your Clutch account. Sign in to turn them on.')}>Sign in</button>
          </div>
        )}
        {account.signedIn && sch.times.length > (account.plan?.features.autoUploadSlots ?? 1) && (
          <div className="card-2 p-3.5 flex items-center gap-3 text-sm">
            <span className="flex-1">Your plan uploads {account.plan?.features.autoUploadSlots ?? 1} time{(account.plan?.features.autoUploadSlots ?? 1) > 1 ? 's' : ''} a day, so only the earliest {account.plan?.features.autoUploadSlots ?? 1} of these run. Pro allows up to 12.</span>
            <button className="btn h-9" onClick={() => setProOpen(true)}>See Pro</button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-5">
          <Field label="Upload times (local)">
            <div className="flex flex-wrap gap-2 items-center">
              {sch.times.map((t) => (
                <span key={t} className="chip h-8 px-2.5 text-ink tabular">{t}<button className="text-ink-3 hover:text-bad" onClick={() => void setSch({ times: sch.times.filter((x) => x !== t) })} aria-label={`Remove ${t}`}><X size={12} /></button></span>
              ))}
              <input type="time" className="input w-36 h-8" value={newTime} onChange={(e) => setNewTime(e.target.value)} aria-label="New time" />
              <button className="btn-sm" onClick={() => newTime && !sch.times.includes(newTime) && void setSch({ times: [...sch.times, newTime].sort() })} aria-label="Add time"><Plus size={14} /></button>
            </div>
          </Field>
          <Field label="Pick clips from">
            <select className="input" value={sch.source} onChange={(e) => void setSch({ source: e.target.value as 'favorites' | 'tag' })}>
              <option value="favorites">Favorites (♥)</option>
              <option value="tag">Clips with a tag</option>
            </select>
            {sch.source === 'tag' && <input className="input mt-2" value={sch.tag} onChange={(e) => void setSch({ tag: e.target.value })} placeholder="upload" />}
          </Field>
          <Field label="Up next">
            {upNext ? (
              <button className="card-2 p-2 flex items-center gap-3 w-full text-left hover:border-line-strong" onClick={() => openClip(upNext.id)}>
                <img src={fileUrl(upNext.thumbnail)} alt="" className="w-16 aspect-video object-cover rounded-md" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{upNext.title}</div>
                  <div className="text-xs text-ink-3 truncate">{upNext.game} · next slot {sch.times[0] ?? '—'}</div>
                </div>
              </button>
            ) : (
              <p className="text-xs text-ink-3 leading-relaxed h-10 flex items-center">Nothing queued. {sch.source === 'favorites' ? 'Favorite a clip' : `Tag a clip "${sch.tag}"`} and it will go out at the next slot.</p>
            )}
          </Field>
        </div>
      </Section>

      <Section title="In progress" icon={<UploadCloud size={16} />} right={active.length ? <Badge tone="live">{active.length}</Badge> : undefined}>
        {active.length === 0 && <p className="text-sm text-ink-3">Nothing uploading. Open a clip → Share to upload now or schedule one.</p>}
        <ul className="divide-y divide-line">
          {active.map(({ clip, upload }) => {
            const Icon = icon[upload.status]
            return (
              <li key={upload.id} className="flex items-center gap-3 py-3">
                <button onClick={() => openClip(clip.id)}><img src={fileUrl(clip.thumbnail)} alt="" className="w-24 aspect-video object-cover rounded-md border border-line" /></button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{upload.title || clip.title}</div>
                  <div className="text-xs text-ink-3 truncate">{clip.game} · YouTube · {upload.status === 'queued' ? `scheduled ${new Date(upload.scheduledAt).toLocaleString()}` : `uploading ${Math.round(upload.progress * 100)}%`}</div>
                  {upload.status === 'uploading' && <div className="mt-1.5"><Progress value={upload.progress} tone="live" /></div>}
                </div>
                <Icon size={18} className={tone[upload.status]} />
                {upload.status === 'queued' && <button className="btn-sm hover:text-bad" onClick={() => void window.cf.upload.cancel(clip.id, upload.id)}>Cancel</button>}
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title="History" icon={<CheckCircle2 size={16} />}>
        {history.length === 0 && <Empty icon={<UploadCloud size={22} />} title="No uploads yet" hint="Finished and failed uploads show up here with links to the videos." />}
        {historyByDay.map(([day, list]) => (
          <div key={day}>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3 mb-1">{day}</div>
            <ul className="divide-y divide-line">
              {list.map(({ clip, upload }) => {
                const Icon = icon[upload.status]
                return (
                  <li key={upload.id} className="flex items-center gap-3 py-2.5">
                    <Icon size={16} className={tone[upload.status]} />
                    <button className="text-sm font-medium truncate text-left hover:text-accent-2" onClick={() => openClip(clip.id)}>{upload.title || clip.title}</button>
                    <span className="text-xs text-ink-3 truncate">{clip.game} · {timeAgo(upload.scheduledAt)}{upload.error ? ` · ${upload.error}` : ''}</span>
                    <span className="flex-1" />
                    {upload.url && <button className="btn-sm" onClick={() => void window.cf.system.openExternal(upload.url!)}>Open</button>}
                    {upload.status === 'failed' && <button className="btn-sm" onClick={() => void window.cf.upload.enqueue(clip.id, upload.platform, { title: upload.title, description: upload.description, tags: upload.tags, privacy: upload.privacy })}>Retry</button>}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </Section>
    </div>
  )
}
