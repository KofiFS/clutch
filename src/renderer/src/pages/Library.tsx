import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, FolderOpen, Heart, Keyboard, Mic, MousePointerClick, Scissors, Search, Trash2, UploadCloud, X } from 'lucide-react'
import type { Clip, TriggerSource } from '../../../shared/types'
import { fileUrl, fmtBytes, fmtDuration, timeAgo, useStore } from '../lib/store'
import { Empty } from '../components/ui'

const TRIGGER_ICON: Record<TriggerSource, typeof Eye> = { hotkey: Keyboard, vision: Eye, voice: Mic, manual: MousePointerClick }
const TRIGGER_LABEL: Record<TriggerSource, string> = { hotkey: 'Hotkey', vision: 'Auto', voice: 'Voice', manual: 'Manual' }

export default function Library() {
  const { libraryVersion, settings } = useStore()
  const [clips, setClips] = useState<Clip[]>([])
  const [games, setGames] = useState<string[]>([])
  const [text, setText] = useState('')
  const [game, setGame] = useState('')
  const [trigger, setTrigger] = useState<TriggerSource | 'all'>('all')
  const [fav, setFav] = useState(false)
  const [sort, setSort] = useState<'newest' | 'oldest' | 'longest' | 'largest'>('newest')
  const [open, setOpen] = useState<Clip | null>(null)

  useEffect(() => {
    void window.cf.library.query({ text, game: game || undefined, trigger, favoritesOnly: fav, sort }).then(setClips)
    void window.cf.library.games().then(setGames)
  }, [text, game, trigger, fav, sort, libraryVersion])

  useEffect(() => {
    if (open) setOpen(clips.find((c) => c.id === open.id) ?? null)
  }, [clips]) // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const map = new Map<string, Clip[]>()
    for (const c of clips) {
      const day = new Date(c.createdAt).toDateString()
      map.set(day, [...(map.get(day) ?? []), c])
    }
    return [...map.entries()]
  }, [clips])

  const toggleFav = (c: Clip) => window.cf.library.update(c.id, { favorite: !c.favorite })

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clips</h1>
          <p className="text-muted text-sm mt-1">{clips.length} clips · saved to {settings?.capture.outputDir}</p>
        </div>
        <button className="btn" onClick={() => void window.cf.library.openFolder()}><FolderOpen size={16} /> Open folder</button>
      </header>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-60">
          <Search size={14} className="absolute left-3 top-2.5 text-muted" />
          <input className="input pl-8" placeholder="Search titles, games, events, tags" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <select className="input w-44" value={game} onChange={(e) => setGame(e.target.value)}>
          <option value="">All games</option>
          {games.map((g) => <option key={g}>{g}</option>)}
        </select>
        <div className="flex rounded-lg border border-line overflow-hidden">
          {(['all', 'hotkey', 'vision', 'voice'] as const).map((t) => (
            <button key={t} onClick={() => setTrigger(t)} className={`px-3 py-2 text-sm cursor-pointer ${trigger === t ? 'bg-accent/20 text-ink' : 'text-muted hover:text-ink'}`}>
              {t === 'all' ? 'All' : TRIGGER_LABEL[t]}
            </button>
          ))}
        </div>
        <button className={`btn ${fav ? 'border-accent text-ink' : ''}`} onClick={() => setFav(!fav)}><Heart size={14} className={fav ? 'fill-bad text-bad' : ''} /> Favorites</button>
        <select className="input w-32" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="longest">Longest</option>
          <option value="largest">Largest</option>
        </select>
      </div>

      {clips.length === 0 && <Empty title="No clips match" hint="Start the buffer and press your clip hotkey, or turn on a trigger under “What to clip”." />}

      {grouped.map(([day, list]) => (
        <section key={day}>
          <h3 className="text-xs uppercase tracking-wide text-muted mb-2">{day === new Date().toDateString() ? 'Today' : day}</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {list.map((c) => {
              const Icon = TRIGGER_ICON[c.trigger]
              return (
                <div key={c.id} className="card overflow-hidden group hover:border-accent/50 transition-colors">
                  <button className="block w-full aspect-video bg-panel-2 relative cursor-pointer" onClick={() => setOpen(c)}>
                    <HoverPreview clip={c} />
                    <span className="absolute bottom-1.5 right-1.5 chip bg-black/60 border-0 text-white">{fmtDuration(c.durationSec)}</span>
                    <span className="absolute top-1.5 left-1.5 chip bg-black/60 border-0 text-white"><Icon size={11} /> {TRIGGER_LABEL[c.trigger]}</span>
                    {c.uploads.some((u) => u.status === 'done') && <span className="absolute top-1.5 right-1.5 chip bg-black/60 border-0 text-white"><UploadCloud size={11} /></span>}
                  </button>
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate" title={c.title}>{c.title}</div>
                        <div className="text-xs text-muted truncate">{c.game} · {timeAgo(c.createdAt)}{c.event ? ` · ${c.event}` : ''}</div>
                      </div>
                      <button onClick={() => void toggleFav(c)} className="cursor-pointer text-muted hover:text-bad"><Heart size={16} className={c.favorite ? 'fill-bad text-bad' : ''} /></button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {open && <Player clip={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function HoverPreview({ clip }: { clip: Clip }) {
  const [hover, setHover] = useState(false)
  return (
    <div className="w-full h-full" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {hover ? (
        <video src={fileUrl(clip.file)} muted autoPlay loop className="w-full h-full object-cover" />
      ) : (
        <img src={fileUrl(clip.thumbnail)} className="w-full h-full object-cover" loading="lazy" />
      )}
    </div>
  )
}

function Player({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [title, setTitle] = useState(clip.title)
  const [tags, setTags] = useState(clip.tags.join(', '))
  const [trim, setTrim] = useState<{ start: number; end: number } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setTitle(clip.title); setTags(clip.tags.join(', ')) }, [clip.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveMeta = () => window.cf.library.update(clip.id, { title: title.trim() || clip.title, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })
  const remove = async () => {
    if (!confirm(`Delete "${clip.title}"? This removes the file from disk.`)) return
    await window.cf.library.remove(clip.id)
    onClose()
  }
  const doTrim = async () => {
    if (!trim) return
    setBusy(true)
    try { await window.cf.library.trim(clip.id, trim.start, trim.end); setTrim(null) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 grid place-items-center p-8" onClick={onClose}>
      <div className="card w-full max-w-5xl max-h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <input className="bg-transparent text-base font-medium focus:outline-none flex-1" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void saveMeta()} />
          <button className="btn" onClick={onClose}><X size={16} /></button>
        </div>
        <video ref={video} src={fileUrl(clip.file)} controls autoPlay className="w-full bg-black max-h-[60vh]" />
        <div className="p-4 grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-3">
            <div className="text-xs text-muted">{clip.game} · {new Date(clip.createdAt).toLocaleString()} · {clip.width}×{clip.height} {clip.fps}fps · {fmtBytes(clip.sizeBytes)}{clip.event ? ` · ${clip.event}` : ''}</div>
            <div>
              <span className="label">Tags</span>
              <input className="input" placeholder="funny, clutch, upload" value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => void saveMeta()} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => void window.cf.library.update(clip.id, { favorite: !clip.favorite })}><Heart size={14} className={clip.favorite ? 'fill-bad text-bad' : ''} /> {clip.favorite ? 'Favorited' : 'Favorite'}</button>
              <button className="btn" onClick={() => void window.cf.upload.enqueue(clip.id, 'youtube')}><UploadCloud size={14} /> Upload to YouTube now</button>
              <button className="btn" onClick={() => setTrim(trim ? null : { start: 0, end: Math.floor(clip.durationSec) })}><Scissors size={14} /> Trim</button>
              <button className="btn" onClick={() => void window.cf.library.reveal(clip.file)}><FolderOpen size={14} /> Show file</button>
              <button className="btn-danger" onClick={() => void remove()}><Trash2 size={14} /> Delete</button>
            </div>
            {trim && (
              <div className="card p-3 bg-panel-2 space-y-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-muted w-10">Start</span>
                  <input type="range" min={0} max={clip.durationSec} step={0.5} value={trim.start} className="flex-1" onChange={(e) => setTrim({ ...trim, start: Math.min(Number(e.target.value), trim.end - 1) })} />
                  <button className="chip cursor-pointer" onClick={() => setTrim({ ...trim, start: video.current?.currentTime ?? 0 })}>use playhead</button>
                  <span className="w-12 text-right tabular-nums">{fmtDuration(trim.start)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted w-10">End</span>
                  <input type="range" min={0} max={clip.durationSec} step={0.5} value={trim.end} className="flex-1" onChange={(e) => setTrim({ ...trim, end: Math.max(Number(e.target.value), trim.start + 1) })} />
                  <button className="chip cursor-pointer" onClick={() => setTrim({ ...trim, end: video.current?.currentTime ?? clip.durationSec })}>use playhead</button>
                  <span className="w-12 text-right tabular-nums">{fmtDuration(trim.end)}</span>
                </div>
                <button className="btn-primary" disabled={busy} onClick={() => void doTrim()}>{busy ? 'Trimming…' : 'Save as new clip'}</button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <span className="label">Uploads</span>
            {clip.uploads.length === 0 && <p className="text-xs text-muted">Not uploaded.</p>}
            {clip.uploads.map((u) => (
              <div key={u.id} className="text-xs card bg-panel-2 p-2 flex items-center justify-between gap-2">
                <span className="capitalize">{u.platform} · {u.status}{u.status === 'uploading' ? ` ${Math.round(u.progress * 100)}%` : ''}</span>
                {u.url && <button className="text-accent-2 cursor-pointer" onClick={() => void window.cf.system.openExternal(u.url!)}>open</button>}
                {u.status === 'queued' && <button className="text-muted cursor-pointer" onClick={() => void window.cf.upload.cancel(clip.id, u.id)}>cancel</button>}
                {u.error && <span className="text-bad truncate" title={u.error}>{u.error}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
