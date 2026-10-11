import { useEffect, useState } from 'react'
import { CalendarClock, CheckCircle2, Clock, Copy, ExternalLink, Loader2, UploadCloud, XCircle, Youtube } from 'lucide-react'
import type { Clip } from '../../../shared/types'
import { useStore } from '../lib/store'
import { useToast } from './Toasts'
import { Field, Progress } from './ui'

/** Per-clip upload editor: title/description/tags/privacy prefilled from the templates, upload now or schedule. */
export function SharePanel({ clip }: { clip: Clip }) {
  const { settings, setPage } = useStore()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [privacy, setPrivacy] = useState<'private' | 'unlisted' | 'public'>('private')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState(() => {
    const d = new Date(Date.now() + 3600_000)
    d.setMinutes(0, 0, 0)
    return toLocalInput(d)
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.cf.upload.preview(clip.id).then((p) => {
      if (!p) return
      setTitle(p.title); setDescription(p.description); setTags(p.tags.join(', ')); setPrivacy(p.privacy)
    })
  }, [clip.id])

  const connected = !!settings?.upload.youtube.connected
  const submit = async () => {
    setBusy(true)
    try {
      await window.cf.upload.enqueue(clip.id, 'youtube', {
        title: title.trim() || undefined,
        description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        privacy,
        scheduledAt: when === 'later' ? new Date(at).toISOString() : undefined
      })
      toast.push({ kind: 'success', title: when === 'later' ? `Scheduled for ${new Date(at).toLocaleString()}` : 'Upload started', body: title })
    } finally {
      setBusy(false)
    }
  }

  const icon = { queued: Clock, uploading: Loader2, done: CheckCircle2, failed: XCircle } as const
  const tone = { queued: 'text-ink-3', uploading: 'text-live animate-spin', done: 'text-ok', failed: 'text-bad' } as const

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="w-8 h-8 rounded-lg bg-[#ff0000]/15 text-[#ff4d4d] grid place-items-center"><Youtube size={16} /></span>
        <div className="min-w-0">
          <div className="font-semibold">YouTube</div>
          <div className="text-xs text-ink-3 truncate">{connected ? settings?.upload.youtube.channelTitle : 'Not connected'}</div>
        </div>
        {!connected && <button className="btn-sm ml-auto" onClick={() => setPage('settings')}>Connect</button>}
      </div>

      <Field label="Title" right={`${title.length}/100`}>
        <input className="input" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea className="textarea min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Tags" hint="Comma separated.">
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Visibility">
          <select className="input" value={privacy} onChange={(e) => setPrivacy(e.target.value as typeof privacy)}>
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
        </Field>
        <Field label="When">
          <select className="input" value={when} onChange={(e) => setWhen(e.target.value as typeof when)}>
            <option value="now">Upload now</option>
            <option value="later">Schedule…</option>
          </select>
        </Field>
      </div>
      {when === 'later' && (
        <Field label="Upload at">
          <input type="datetime-local" className="input" value={at} min={toLocalInput(new Date())} onChange={(e) => setAt(e.target.value)} />
        </Field>
      )}
      <button className="btn-primary w-full" disabled={!connected || busy} onClick={() => void submit()}>
        {when === 'later' ? <CalendarClock size={16} /> : <UploadCloud size={16} />} {when === 'later' ? 'Schedule upload' : 'Upload to YouTube'}
      </button>

      <div className="pt-2 border-t border-line space-y-2">
        <div className="flex items-center justify-between">
          <span className="label mb-0">History</span>
          <button className="text-xs text-ink-3 hover:text-ink flex items-center gap-1" onClick={() => { void navigator.clipboard.writeText(clip.file); toast.push({ kind: 'info', title: 'File path copied' }) }}><Copy size={12} /> Copy path</button>
        </div>
        {clip.uploads.length === 0 && <p className="text-xs text-ink-3">Not uploaded yet.</p>}
        {clip.uploads.map((u) => {
          const Icon = icon[u.status]
          return (
            <div key={u.id} className="card-2 p-2.5 text-xs space-y-1.5">
              <div className="flex items-center gap-2">
                <Icon size={14} className={tone[u.status]} />
                <span className="capitalize font-medium">{u.platform} · {u.status}</span>
                <span className="ml-auto text-ink-3 tabular">{new Date(u.scheduledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              {u.status === 'uploading' && <Progress value={u.progress} tone="live" />}
              {u.error && <div className="text-bad break-words">{u.error}</div>}
              <div className="flex gap-2">
                {u.url && <button className="text-live hover:underline flex items-center gap-1" onClick={() => void window.cf.system.openExternal(u.url!)}><ExternalLink size={11} /> Open video</button>}
                {u.status === 'queued' && <button className="text-ink-3 hover:text-bad" onClick={() => void window.cf.upload.cancel(clip.id, u.id)}>Cancel</button>}
                {u.status === 'failed' && <button className="text-ink-3 hover:text-ink" onClick={() => void window.cf.upload.enqueue(clip.id, u.platform, { title: u.title, description: u.description, tags: u.tags, privacy: u.privacy })}>Retry</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
