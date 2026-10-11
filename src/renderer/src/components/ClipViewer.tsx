import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FolderOpen, Heart, Pause, Play, Scissors, Trash2, Volume2, VolumeX, X, Repeat } from 'lucide-react'
import type { Clip } from '../../../shared/types'
import { fileUrl, fmtBytes, fmtTime, useStore } from '../lib/store'
import { GameIcon, InlineEdit, Kbd, useConfirm } from './ui'
import { useToast } from './Toasts'
import { SharePanel } from './SharePanel'

/**
 * Full clip viewer: player, trim timeline with draggable in/out handles, metadata, share panel,
 * prev/next navigation and keyboard shortcuts.
 */
export function ClipViewer({ clipId, onClose }: { clipId: string; onClose: () => void }) {
  const { openClip, libraryVersion, settings } = useStore()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const [clip, setClip] = useState<Clip | null>(null)
  const [neighbors, setNeighbors] = useState<{ prev?: string; next?: string }>({})
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [trim, setTrim] = useState<{ start: number; end: number } | null>(null)
  const [loop, setLoop] = useState(true)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'details' | 'share'>('details')
  const video = useRef<HTMLVideoElement>(null)
  const timeline = useRef<HTMLDivElement>(null)
  const dragging = useRef<'start' | 'end' | 'seek' | null>(null)

  useEffect(() => {
    void window.cf.library.get(clipId).then((c) => setClip(c ?? null))
    void window.cf.library.query({ sort: 'newest' }).then((list) => {
      const i = list.findIndex((c) => c.id === clipId)
      setNeighbors({ prev: list[i - 1]?.id, next: list[i + 1]?.id })
    })
    setTrim(null)
  }, [clipId, libraryVersion])
  useEffect(() => { setTab('details'); void window.cf.library.viewed(clipId) }, [clipId])

  const seek = useCallback((t: number) => { if (video.current) video.current.currentTime = Math.max(0, Math.min(duration, t)) }, [duration])
  const togglePlay = useCallback(() => { const v = video.current; if (!v) return; v.paused ? void v.play() : v.pause() }, [])

  // Keep playback inside the trim range when looping a selection.
  useEffect(() => {
    const v = video.current
    if (!v || !trim || !loop) return
    const onTime = () => { if (v.currentTime >= trim.end || v.currentTime < trim.start - 0.5) v.currentTime = trim.start }
    v.addEventListener('timeupdate', onTime)
    return () => v.removeEventListener('timeupdate', onTime)
  }, [trim, loop])

  const toggleFav = useCallback(() => { if (clip) void window.cf.library.update(clip.id, { favorite: !clip.favorite }) }, [clip])
  const remove = useCallback(async () => {
    if (!clip) return
    const useTrash = settings?.app.useTrash
    if (!useTrash && !(await confirm({ title: `Delete "${clip.title}"?`, body: 'The file is removed from disk permanently.', confirmLabel: 'Delete', danger: true }))) return
    const id = clip.id
    const toTrash = await window.cf.library.trash([id])
    toast.push({ kind: 'info', title: toTrash ? 'Moved to trash' : 'Deleted', body: clip.title, action: toTrash ? { label: 'Undo', onClick: () => void window.cf.library.restore([id]) } : undefined })
    if (neighbors.next) openClip(neighbors.next)
    else if (neighbors.prev) openClip(neighbors.prev)
    else onClose()
  }, [clip, neighbors, onClose, openClip, settings, toast, confirm])

  const saveTrim = async (mode: 'new' | 'replace') => {
    if (!clip || !trim) return
    setBusy(true)
    try {
      const out = await window.cf.library.trim(clip.id, trim.start, trim.end, mode)
      toast.push({ kind: 'success', title: mode === 'replace' ? 'Clip trimmed' : 'Saved trimmed copy', body: `${fmtTime(trim.start)} – ${fmtTime(trim.end)}` })
      setTrim(null)
      if (out) openClip(out.id)
    } catch (e) {
      toast.push({ kind: 'error', title: 'Trim failed', body: String((e as Error)?.message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const v = video.current
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break
        case 'ArrowLeft': e.preventDefault(); seek((v?.currentTime ?? 0) - (e.shiftKey ? 5 : 1)); break
        case 'ArrowRight': e.preventDefault(); seek((v?.currentTime ?? 0) + (e.shiftKey ? 5 : 1)); break
        case ',': seek((v?.currentTime ?? 0) - 1 / 60); break
        case '.': seek((v?.currentTime ?? 0) + 1 / 60); break
        case 'i': case 'I': setTrim((t) => ({ start: Math.min(v?.currentTime ?? 0, (t?.end ?? duration) - 0.5), end: t?.end ?? duration })); break
        case 'o': case 'O': setTrim((t) => ({ start: t?.start ?? 0, end: Math.max(v?.currentTime ?? duration, (t?.start ?? 0) + 0.5) })); break
        case 'f': case 'F': toggleFav(); break
        case 'm': case 'M': setMuted((m) => !m); break
        case 'Delete': void remove(); break
        case '[': if (neighbors.prev) openClip(neighbors.prev); break
        case ']': if (neighbors.next) openClip(neighbors.next); break
        case 'Escape': onClose(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seek, duration, toggleFav, remove, neighbors, openClip, onClose])

  // Timeline dragging
  const posToTime = (clientX: number) => {
    const r = timeline.current!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration))
  }
  const onPointerDown = (e: React.PointerEvent, what: 'start' | 'end' | 'seek') => {
    e.preventDefault()
    dragging.current = what
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    onPointerMove(e)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !duration) return
    const t = posToTime(e.clientX)
    if (dragging.current === 'seek') seek(t)
    else if (dragging.current === 'start') setTrim((tr) => ({ start: Math.min(t, (tr?.end ?? duration) - 0.5), end: tr?.end ?? duration }))
    else setTrim((tr) => ({ start: tr?.start ?? 0, end: Math.max(t, (tr?.start ?? 0) + 0.5) }))
  }
  const onPointerUp = () => { dragging.current = null }

  if (!clip) return null
  const pct = (t: number) => (duration ? (t / duration) * 100 : 0)

  return (
    <div className="fixed inset-0 z-[100] bg-[rgba(2,8,20,0.5)] backdrop-blur-xl flex items-center justify-center p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" className="card hud w-full max-w-[1320px] h-full max-h-[880px] flex overflow-hidden shadow-[var(--shadow-pop)] pop-in">
        {/* Player column */}
        <div className="relative z-[2] flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 px-5 h-14 border-b border-white/10">
            <GameIcon src={clip.gameIcon ? fileUrl(clip.gameIcon) : undefined} name={clip.game} size={18} />
            <InlineEdit value={clip.title} onSave={(title) => void window.cf.library.update(clip.id, { title })} className="font-semibold text-[15px] truncate max-w-[520px]" />
            <span className="text-xs text-ink-3 truncate">{clip.game}</span>
            <div className="ml-auto flex items-center gap-1">
              <button className="btn-ghost h-9 w-9 px-0" disabled={!neighbors.prev} onClick={() => neighbors.prev && openClip(neighbors.prev)} title="Previous clip ["><ChevronLeft size={18} /></button>
              <button className="btn-ghost h-9 w-9 px-0" disabled={!neighbors.next} onClick={() => neighbors.next && openClip(neighbors.next)} title="Next clip ]"><ChevronRight size={18} /></button>
              <button className="btn-ghost h-9 w-9 px-0" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </div>
          </div>

          <div className="flex-1 min-h-0 grid place-items-center relative bg-black/70 m-3 mb-0 rounded-[18px] overflow-hidden" onClick={togglePlay}>
            <video
              ref={video}
              src={fileUrl(clip.file)}
              autoPlay
              muted={muted}
              className="max-w-full max-h-full"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onEnded={() => { if (!trim) { seek(0); void video.current?.play() } }}
            />
            {!playing && (
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <div className="w-16 h-16 rounded-full bg-black/60 border border-white/10 grid place-items-center"><Play size={26} className="text-white ml-1" /></div>
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="px-4 pt-3 pb-3 space-y-2">
            <div
              ref={timeline}
              className="relative h-11 rounded-full overflow-hidden cursor-pointer select-none touch-none border border-white/12" style={{ background: "rgba(0,10,25,0.45)", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.5)" }}
              onPointerDown={(e) => onPointerDown(e, 'seek')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {/* progress */}
              <div className="absolute inset-y-0 left-0" style={{ width: `${pct(time)}%`, background: "linear-gradient(90deg, rgba(155,123,255,0.35), rgba(79,227,255,0.45))" }} />
              {trim && (
                <>
                  <div className="absolute inset-y-0 left-0 bg-black/55" style={{ width: `${pct(trim.start)}%` }} />
                  <div className="absolute inset-y-0 right-0 bg-black/55" style={{ width: `${100 - pct(trim.end)}%` }} />
                  <div className="absolute inset-y-0 border-y-2 border-live pointer-events-none" style={{ left: `${pct(trim.start)}%`, width: `${pct(trim.end) - pct(trim.start)}%` }} />
                  <div className="absolute top-0 bottom-0 w-3 -ml-1.5 bg-live rounded-l-md cursor-ew-resize z-10 grid place-items-center" style={{ left: `${pct(trim.start)}%` }} onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, 'start') }} title="Trim start (I)"><span className="w-0.5 h-4 bg-black/50" /></div>
                  <div className="absolute top-0 bottom-0 w-3 -ml-1.5 bg-live rounded-r-md cursor-ew-resize z-10 grid place-items-center" style={{ left: `${pct(trim.end)}%` }} onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, 'end') }} title="Trim end (O)"><span className="w-0.5 h-4 bg-black/50" /></div>
                </>
              )}
              <div className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_10px_#4fe3ff,0_0_4px_#fff] pointer-events-none" style={{ left: `${pct(time)}%` }} />
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost h-9 w-9 px-0" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
              <button className="btn-ghost h-9 w-9 px-0" onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
              <span className="font-hud text-[11px] tabular text-ink-2 w-28">{fmtTime(time)} / {fmtTime(duration)}</span>
              <span className="flex-1" />
              {trim ? (
                <>
                  <span className="text-xs text-ink-2 tabular flex items-center gap-1"><Scissors size={12} className="text-live" /> {fmtTime(trim.start)} – {fmtTime(trim.end)} <span className="text-ink-3">({fmtTime(trim.end - trim.start)})</span></span>
                  <button className={`btn-sm ${loop ? 'border-live/50 text-ink' : ''}`} onClick={() => setLoop(!loop)} title="Loop the selection"><Repeat size={13} /></button>
                  <button className="btn-sm" onClick={() => seek(trim.start)}>Preview</button>
                  <button className="btn-sm" onClick={() => setTrim(null)}>Cancel</button>
                  <button className="btn-sm" disabled={busy} onClick={() => void saveTrim('new')}>Save as copy</button>
                  <button className="btn-sm bg-accent border-accent text-white hover:bg-accent-2" disabled={busy} onClick={() => void saveTrim('replace')}>{busy ? 'Trimming…' : 'Trim clip'}</button>
                </>
              ) : (
                <>
                  <span className="text-[11px] text-ink-3 hidden xl:flex items-center gap-1.5"><Kbd>Space</Kbd> play <Kbd>←</Kbd><Kbd>→</Kbd> 1s <Kbd>I</Kbd><Kbd>O</Kbd> trim <Kbd>F</Kbd> fav <Kbd>[</Kbd><Kbd>]</Kbd> prev/next</span>
                  <button className="btn-sm" onClick={() => setTrim({ start: 0, end: duration })}><Scissors size={13} /> Trim</button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Side panel */}
        <aside className="relative z-[2] w-[340px] shrink-0 border-l border-white/10 flex flex-col">
          <div className="flex p-2.5 gap-1 border-b border-white/10">
            {(['details', 'share'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`flex-1 h-9 rounded-full text-sm font-medium capitalize transition-all ${tab === t ? 'text-ink liquid bg-white/15 shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.5),0_0_16px_-6px_rgba(79,227,255,0.7)]' : 'text-ink-3 hover:text-ink-2'}`}>{t}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {tab === 'details' ? (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <dt className="text-ink-3">Recorded</dt><dd>{new Date(clip.createdAt).toLocaleString()}</dd>
                  <dt className="text-ink-3">Length</dt><dd className="tabular">{fmtTime(clip.durationSec)}</dd>
                  <dt className="text-ink-3">Video</dt><dd className="tabular">{clip.width}×{clip.height} · {clip.fps} fps</dd>
                  <dt className="text-ink-3">File</dt><dd className="tabular">{fmtBytes(clip.sizeBytes)}</dd>
                  <dt className="text-ink-3">Trigger</dt><dd className="capitalize">{clip.trigger}{clip.event ? ` · ${clip.event}` : ''}</dd>
                </dl>
                <div>
                  <span className="label">Tags</span>
                  <TagEditor value={clip.tags} onChange={(tags) => void window.cf.library.update(clip.id, { tags })} />
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button className={`btn ${clip.favorite ? 'border-bad/50' : ''}`} onClick={toggleFav}><Heart size={15} className={clip.favorite ? 'fill-bad text-bad' : ''} /> {clip.favorite ? 'Favorited' : 'Favorite'}</button>
                  <button className="btn" onClick={() => setTab('share')}>Share / upload</button>
                  <button className="btn" onClick={() => void window.cf.library.reveal(clip.file)}><FolderOpen size={15} /> Show file</button>
                  <button className="btn-danger" onClick={() => void remove()}><Trash2 size={15} /> Delete</button>
                </div>
              </div>
            ) : (
              <SharePanel clip={clip} />
            )}
          </div>
        </aside>
      </div>
      {confirmDialog}
    </div>
  )
}

function TagEditor({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const tags = draft.split(',').map((t) => t.trim()).filter(Boolean)
    if (tags.length) onChange([...new Set([...value, ...tags])])
    setDraft('')
  }
  return (
    <div className="input h-auto min-h-10 py-1.5 flex flex-wrap gap-1.5 items-center">
      {value.map((t) => (
        <span key={t} className="chip text-ink">{t}<button className="text-ink-3 hover:text-bad" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X size={11} /></button></span>
      ))}
      <input className="bg-transparent text-sm focus:outline-none flex-1 min-w-20" placeholder={value.length ? '' : 'funny, clutch, upload'} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } }} onBlur={add} />
    </div>
  )
}
