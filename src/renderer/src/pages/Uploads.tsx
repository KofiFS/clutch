import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, Loader2, Plus, X, XCircle } from 'lucide-react'
import type { Clip, UploadRecord } from '../../../shared/types'
import { fileUrl, timeAgo, useStore } from '../lib/store'
import { Empty, Field, Section, Toggle } from '../components/ui'

export default function Uploads() {
  const { settings, save, uploadsVersion, libraryVersion } = useStore()
  const [items, setItems] = useState<{ clip: Clip; upload: UploadRecord }[]>([])
  const [newTime, setNewTime] = useState('18:00')
  useEffect(() => { void window.cf.upload.list().then(setItems) }, [uploadsVersion, libraryVersion])
  if (!settings) return null
  const sch = settings.upload.schedule
  const setSch = (patch: Partial<typeof sch>) => save({ upload: { ...settings.upload, schedule: { ...sch, ...patch } } })
  const yt = settings.upload.youtube

  const icon = { queued: Clock, uploading: Loader2, done: CheckCircle2, failed: XCircle } as const
  const color = { queued: 'text-muted', uploading: 'text-accent-2 animate-spin', done: 'text-ok', failed: 'text-bad' } as const

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Uploads</h1>
        <p className="text-muted text-sm mt-1">{yt.connected ? `Connected to YouTube as ${yt.channelTitle}.` : 'Connect YouTube under Settings → Accounts to upload.'}</p>
      </header>

      <Section
        title="Auto-upload schedule"
        desc="At each time below, the oldest favorite (or tagged) clip that hasn't been uploaded yet goes out. Mark the clips you like and ClipForge keeps your channel fed."
        right={<Toggle checked={sch.enabled} onChange={(enabled) => void setSch({ enabled })} label={sch.enabled ? 'On' : 'Off'} />}
      >
        <div className="grid grid-cols-3 gap-4">
          <Field label="Upload times (local)">
            <div className="flex flex-wrap gap-2 items-center">
              {sch.times.map((t) => (
                <span key={t} className="chip text-ink">{t} <button className="cursor-pointer text-muted hover:text-bad" onClick={() => void setSch({ times: sch.times.filter((x) => x !== t) })}><X size={12} /></button></span>
              ))}
              <input type="time" className="input w-28" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              <button className="btn" onClick={() => newTime && !sch.times.includes(newTime) && void setSch({ times: [...sch.times, newTime].sort() })}><Plus size={14} /></button>
            </div>
          </Field>
          <Field label="Pick clips from">
            <select className="input" value={sch.source} onChange={(e) => void setSch({ source: e.target.value as 'favorites' | 'tag' })}>
              <option value="favorites">Favorites (♥)</option>
              <option value="tag">Clips with a tag</option>
            </select>
            {sch.source === 'tag' && <input className="input mt-2" value={sch.tag} onChange={(e) => void setSch({ tag: e.target.value })} placeholder="upload" />}
          </Field>
          <Field label="Platforms">
            <div className="space-y-2">
              <Toggle checked={sch.platforms.includes('youtube')} onChange={(on) => void setSch({ platforms: on ? [...new Set([...sch.platforms, 'youtube' as const])] : sch.platforms.filter((p) => p !== 'youtube') })} label="YouTube" />
              <Toggle checked={false} onChange={() => undefined} label="TikTok / Twitch" hint="Coming later: neither offers a public clip-upload API yet." />
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Queue & history">
        {items.length === 0 && <Empty title="Nothing queued" hint="Open a clip and choose “Upload to YouTube now”, or turn on the schedule." />}
        <ul className="divide-y divide-line">
          {items.map(({ clip, upload }) => {
            const Icon = icon[upload.status]
            return (
              <li key={upload.id} className="flex items-center gap-3 py-3">
                <img src={fileUrl(clip.thumbnail)} className="w-24 aspect-video object-cover rounded-md border border-line" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{clip.title}</div>
                  <div className="text-xs text-muted truncate">{clip.game} · {upload.platform} · {upload.status === 'queued' ? `scheduled ${new Date(upload.scheduledAt).toLocaleString()}` : timeAgo(upload.scheduledAt)}{upload.error ? ` · ${upload.error}` : ''}</div>
                  {upload.status === 'uploading' && <div className="h-1.5 bg-line rounded-full mt-1.5 overflow-hidden"><div className="h-full bg-accent-2 transition-[width]" style={{ width: `${Math.round(upload.progress * 100)}%` }} /></div>}
                </div>
                <Icon size={18} className={color[upload.status]} />
                {upload.url && <button className="btn" onClick={() => void window.cf.system.openExternal(upload.url!)}>Open</button>}
                {upload.status === 'queued' && <button className="btn-danger" onClick={() => void window.cf.upload.cancel(clip.id, upload.id)}>Cancel</button>}
                {upload.status === 'failed' && <button className="btn" onClick={() => void window.cf.upload.enqueue(clip.id, upload.platform)}>Retry</button>}
              </li>
            )
          })}
        </ul>
      </Section>
    </div>
  )
}
