import { useEffect, useState } from 'react'
import { CalendarClock, CheckCircle2, Clock, Cloud, Copy, ExternalLink, Link2, Loader2, MessageSquare, Send, Trash2, UploadCloud, XCircle, Youtube } from 'lucide-react'
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
      <CloudShareBlock clip={clip} />
      <div className="pt-4 border-t border-line"><DiscordBlock clip={clip} /></div>
      <div className="flex items-center gap-2 text-sm pt-4 border-t border-line">
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

function DiscordBlock({ clip }: { clip: Clip }) {
  const { settings, goTo } = useStore()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = !!settings?.discord.webhookUrl
  const posts = clip.discordPosts ?? []
  const post = async () => {
    setBusy(true)
    try {
      const r = await window.cf.discord.post(clip.id, { note: note.trim() || undefined })
      toast.push({ kind: 'success', title: 'Posted to Discord', body: r.transcoded ? `Sent a ${settings?.discord.maxMb} MB copy that plays inline.` : clip.title })
      setNote('')
    } catch (e) {
      toast.push({ kind: 'error', title: 'Discord post failed', body: String((e as Error)?.message ?? e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="w-8 h-8 rounded-lg bg-[#5865F2]/20 text-[#8b95ff] grid place-items-center"><MessageSquare size={16} /></span>
        <div className="min-w-0">
          <div className="font-semibold">Discord</div>
          <div className="text-xs text-ink-3 truncate">{ready ? (posts.length ? `Posted ${posts.length}× · last ${new Date(posts[posts.length - 1]).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'Plays inline in your channel') : 'Not set up'}</div>
        </div>
        {!ready && <button className="btn-sm ml-auto" onClick={() => goTo('settings', 'Discord')}>Set up</button>}
      </div>
      {ready && (
        <>
          <input className="input" placeholder="Add a message (optional)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void post() }} />
          <button className="btn w-full bg-[#5865F2] border-[#5865F2] text-white hover:bg-[#4752c4] hover:border-[#4752c4]" disabled={busy} onClick={() => void post()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {busy ? 'Preparing & posting…' : 'Post to Discord'}
          </button>
        </>
      )}
    </div>
  )
}

/** Clutch cloud share link: anyone can watch in a browser, and it plays inline in Discord. */
function CloudShareBlock({ clip }: { clip: Clip }) {
  const { account, signIn } = useStore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const off = window.cf.on('cloud-progress', (p: { clipId: string; progress: number }) => { if (p.clipId === clip.id) setProgress(p.progress) })
    return () => { off() }
  }, [clip.id])
  const cloud = clip.cloud && (!clip.cloud.expires || clip.cloud.expires > Date.now()) ? clip.cloud : null
  const copy = (url: string) => { void navigator.clipboard.writeText(url); toast.push({ kind: 'success', title: 'Link copied', body: url }) }
  const create = async () => {
    if (!account.signedIn) { signIn('Share links live in your Clutch cloud. Sign in (free) to create one.'); return }
    setBusy(true); setProgress(0)
    try { const r = await window.cf.cloud.share(clip.id); copy(r.shareUrl) }
    catch (e) { toast.push({ kind: 'error', title: 'Could not create the link', body: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': Error: /, '') }) }
    finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="w-8 h-8 rounded-lg bg-accent/15 text-accent grid place-items-center"><Cloud size={16} /></span>
        <div className="min-w-0">
          <div className="font-semibold">Share link</div>
          <div className="text-xs text-ink-3 truncate">{cloud ? (cloud.expires ? `Expires ${new Date(cloud.expires).toLocaleDateString()}` : 'Never expires') : account.signedIn ? 'Upload once, share anywhere' : 'Needs a free Clutch account'}</div>
        </div>
      </div>
      {cloud ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className="input font-mono text-[12px]" readOnly value={cloud.shareUrl} onFocus={(e) => e.target.select()} aria-label="Share link" />
            <button className="btn-icon" onClick={() => copy(cloud.shareUrl)} aria-label="Copy link"><Copy size={15} /></button>
          </div>
          <div className="flex gap-2">
            <button className="btn-sm" onClick={() => void window.cf.system.openExternal(cloud.shareUrl)}><ExternalLink size={12} /> Open</button>
            <button className="btn-sm hover:text-bad" onClick={() => void window.cf.cloud.unshare(clip.id)}><Trash2 size={12} /> Delete from cloud</button>
          </div>
        </div>
      ) : (
        <>
          <button className="btn-primary w-full" disabled={busy} onClick={() => void create()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />} {busy ? (progress > 0 ? `Uploading ${Math.round(progress * 100)}%` : 'Preparing…') : account.signedIn ? 'Create share link' : 'Sign in to share'}</button>
          {busy && progress > 0 && <Progress value={progress} />}
        </>
      )}
    </div>
  )
}
