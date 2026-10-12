import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FolderOpen, Heart, Maximize, Minimize, PanelRightClose, PanelRightOpen, Pause, Play, Scissors, Trash2, Volume2, VolumeX, X, Repeat } from 'lucide-react'
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
  const wasPlaying = useRef(false)
  const [scrub, setScrubState] = useState<number | null>(null)
  const scrubRef = useRef<number | null>(null)
  const setScrub = (t: number | null) => { scrubRef.current = t; setScrubState(t) }
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  // Bigger video: hide the details panel (T), or go fullscreen with the timeline and controls (F).
  const player = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [wide, setWide] = useState(() => { try { return localStorage.getItem('cf.viewer.wide') === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('cf.viewer.wide', wide ? '1' : '0') } catch { /* private mode */ } }, [wide])
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === player.current && !!player.current)
    document.addEventListener('fullscreenchange', on)
    return () => {
      document.removeEventListener('fullscreenchange', on)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, [])
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void player.current?.requestFullscreen().catch(() => undefined)
  }, [])

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
        case 'f': case 'F': toggleFullscreen(); break
        case 'l': case 'L': toggleFav(); break
        case 't': case 'T': if (!document.fullscreenElement) setWide((w) => !w); break
        case 'm': case 'M': setMuted((m) => !m); break
        case 'Delete': void remove(); break
        case '[': if (neighbors.prev) openClip(neighbors.prev); break
        case ']': if (neighbors.next) openClip(neighbors.next); break
        // In fullscreen, Esc only leaves fullscreen (Electron doesn't do it by itself); it doesn't close the clip.
        case 'Escape': if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); else onClose(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seek, duration, toggleFav, toggleFullscreen, remove, neighbors, openClip, onClose])

  // Timeline: click or drag anywhere to scrub. While dragging, playback pauses and the playhead
  // follows the cursor immediately (timeupdate only fires ~4x a second); playback resumes on release.
  const posToTime = (clientX: number) => {
    const r = timeline.current!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration))
  }
  const onPointerDown = (e: React.PointerEvent, what: 'start' | 'end' | 'seek') => {
    if (e.button !== 0 || !duration) return
    e.preventDefault()
    dragging.current = what
    // Capture on the bar itself so moves keep coming even when the cursor leaves it.
    timeline.current?.setPointerCapture(e.pointerId)
    if (what === 'seek') {
      const v = video.current
      wasPlaying.current = !!v && !v.paused
      v?.pause()
    }
    onPointerMove(e)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!duration || !timeline.current) return
    const t = posToTime(e.clientX)
    const r = timeline.current.getBoundingClientRect()
    setHover({ x: Math.max(0, Math.min(r.width, e.clientX - r.left)), t })
    if (!dragging.current) return
    if (dragging.current === 'seek') {
      setScrub(t)
      if (video.current) video.current.currentTime = t
    } else if (dragging.current === 'start') setTrim((tr) => ({ start: Math.min(t, (tr?.end ?? duration) - 0.5), end: tr?.end ?? duration }))
    else setTrim((tr) => ({ start: tr?.start ?? 0, end: Math.max(t, (tr?.start ?? 0) + 0.5) }))
  }
  const onPointerUp = (e?: React.PointerEvent) => {
    const what = dragging.current
    dragging.current = null
    if (e && timeline.current?.hasPointerCapture(e.pointerId)) timeline.current.releasePointerCapture(e.pointerId)
    if (what === 'seek') {
      if (scrubRef.current !== null) setTime(scrubRef.current)
      setScrub(null)
      if (wasPlaying.current) void video.current?.play()
    }
  }

  if (!clip) return null
  const pct = (t: number) => (duration ? (t / duration) * 100 : 0)
  const shown = scrub ?? time

  return (
    <div className="fixed inset-0 z-[100] bg-[rgba(2,8,20,0.5)] backdrop-blur-xl flex items-center justify-center p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" className="card hud w-full max-w-[1320px] h-full max-h-[880px] flex overflow-hidden shadow-[var(--shadow-pop)] pop-in" style={{ background: 'linear-gradient(160deg, rgba(24,24,28,0.92), rgba(14,14,17,0.94))' }}>
        {/* Player column */}
        <div ref={player} className="clip-player relative z-[2] flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 px-5 h-14 border-b border-white/10">
            <GameIcon src={clip.gameIcon ? fileUrl(clip.gameIcon) : undefined} name={clip.game} size={18} />
            <InlineEdit value={clip.title} onSave={(title) => void window.cf.library.update(clip.id, { title })} className="font-semibold text-[15px] truncate max-w-[520px]" />
            <span className="text-xs text-ink-3 truncate">{clip.game}</span>
            <div className="ml-auto flex items-center gap-1">
              <button className="btn-ghost h-9 w-9 px-0" disabled={!neighbors.prev} onClick={() => neighbors.prev && openClip(neighbors.prev)} title="Previous clip ["><ChevronLeft size={18} /></button>
              <button className="btn-ghost h-9 w-9 px-0" disabled={!neighbors.next} onClick={() => neighbors.next && openClip(neighbors.next)} title="Next clip ]"><ChevronRight size={18} /></button>
              {!fullscreen && <button className="btn-ghost h-9 w-9 px-0" onClick={() => setWide(!wide)} aria-label={wide ? 'Show details panel' : 'Hide details panel'} title={`${wide ? 'Show' : 'Hide'} details (T)`}>{wide ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}</button>}
              <button className="btn-ghost h-9 w-9 px-0" onClick={fullscreen ? toggleFullscreen : onClose} aria-label={fullscreen ? 'Exit fullscreen' : 'Close'}>{fullscreen ? <Minimize size={18} /> : <X size={18} />}</button>
            </div>
          </div>

          <div className="flex-1 min-h-0 grid place-items-center relative bg-black/70 m-3 mb-0 rounded-[18px] overflow-hidden" onClick={togglePlay} onDoubleClick={toggleFullscreen}>
            <video
              ref={video}
              src={fileUrl(clip.file)}
              autoPlay
              muted={muted}
              className="max-w-full max-h-full w-full h-full object-contain"
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
            <div className="relative group/tl">
            {hover && (
              <div className="absolute -top-9 z-20 pointer-events-none -translate-x-1/2" style={{ left: hover.x }}>
                <span className="font-hud text-[11px] tabular px-2 py-1 rounded-lg border border-white/15" style={{ background: 'rgba(20,20,24,0.92)', boxShadow: '0 8px 20px -8px rgba(0,0,0,0.9)' }}>{fmtTime(hover.t)}</span>
              </div>
            )}
            <div
              ref={timeline}
              className={`relative h-11 rounded-full overflow-hidden select-none touch-none border border-white/12 ${dragging.current === 'seek' ? 'cursor-grabbing' : 'cursor-pointer'}`}
              style={{ background: 'rgba(0,0,0,0.45)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)' }}
              onPointerDown={(e) => onPointerDown(e, 'seek')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => { if (!dragging.current) setHover(null) }}
            >
              {/* progress */}
              <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${pct(shown)}%`, background: 'linear-gradient(90deg, rgba(155,123,255,0.35), rgba(79,227,255,0.45))' }} />
              {hover && !dragging.current && <div className="absolute top-0 bottom-0 w-px bg-white/35 pointer-events-none" style={{ left: hover.x }} />}
              {trim && (
                <>
                  <div className="absolute inset-y-0 left-0 bg-black/55" style={{ width: `${pct(trim.start)}%` }} />
                  <div className="absolute inset-y-0 right-0 bg-black/55" style={{ width: `${100 - pct(trim.end)}%` }} />
                  <div className="absolute inset-y-0 border-y-2 border-live pointer-events-none" style={{ left: `${pct(trim.start)}%`, width: `${pct(trim.end) - pct(trim.start)}%` }} />
                  <div className="absolute top-0 bottom-0 w-3 -ml-1.5 bg-live rounded-l-md cursor-ew-resize z-10 grid place-items-center" style={{ left: `${pct(trim.start)}%` }} onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, 'start') }} title="Trim start (I)"><span className="w-0.5 h-4 bg-black/50" /></div>
                  <div className="absolute top-0 bottom-0 w-3 -ml-1.5 bg-live rounded-r-md cursor-ew-resize z-10 grid place-items-center" style={{ left: `${pct(trim.end)}%` }} onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, 'end') }} title="Trim end (O)"><span className="w-0.5 h-4 bg-black/50" /></div>
                </>
              )}
              {(clip.bookmarks ?? []).map((b, i) => (
                <button
                  key={i}
                  title={`Bookmark ${i + 1} · ${fmtTime(b)}`}
                  onPointerDown={(e) => { e.stopPropagation(); seek(b); setTime(b) }}
                  className="absolute top-1 w-3 h-3 -ml-1.5 rotate-45 rounded-[3px] z-10 bg-[#ffc857] shadow-[0_0_8px_#ffc857] hover:scale-125 transition-transform"
                  style={{ left: `${pct(b)}%` }}
                />
              ))}
              <div className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_10px_#4fe3ff,0_0_4px_#fff] pointer-events-none" style={{ left: `${pct(shown)}%` }}>
                {/* Grab knob: grows while hovering or dragging */}
                <span className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_12px_#4fe3ff] transition-all duration-150 ${scrub !== null ? 'w-4 h-4' : 'w-2.5 h-2.5 group-hover/tl:w-3.5 group-hover/tl:h-3.5'}`} />
              </div>
            </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost h-9 w-9 px-0" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
              <button className="btn-ghost h-9 w-9 px-0" onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
              <span className="font-hud text-[11px] tabular text-ink-2 w-28">{fmtTime(shown)} / {fmtTime(duration)}</span>
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
                  <span className="text-[11px] text-ink-3 hidden xl:flex items-center gap-1.5"><Kbd>Space</Kbd> play <Kbd>←</Kbd><Kbd>→</Kbd> 1s <Kbd>I</Kbd><Kbd>O</Kbd> trim <Kbd>F</Kbd> fullscreen <Kbd>L</Kbd> fav</span>
                  <button className="btn-sm" onClick={() => setTrim({ start: 0, end: duration })}><Scissors size={13} /> Trim</button>
                </>
              )}
              <button className="btn-ghost h-9 w-9 px-0" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={fullscreen ? 'Exit fullscreen (F or Esc)' : 'Fullscreen (F)'}>{fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>
            </div>
          </div>
        </div>

        {/* Side panel */}
        <aside className={`relative z-[2] w-[340px] shrink-0 border-l border-white/10 flex-col ${wide ? 'hidden' : 'flex'}`}>
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
                {(clip.bookmarks?.length ?? 0) > 0 && (
                  <div>
                    <span className="label">Bookmarks</span>
                    <ul className="space-y-1.5">
                      {clip.bookmarks!.map((b, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className="w-2.5 h-2.5 rotate-45 rounded-[2px] bg-[#ffc857] shrink-0" />
                          <button className="font-hud text-[12px] tabular hover:text-accent" onClick={() => seek(b)}>{fmtTime(b)}</button>
                          <span className="flex-1" />
                          <button
                            className="btn-sm"
                            disabled={busy}
                            title={`Save ${settings?.capture.preSeconds ?? 20}s before and ${settings?.capture.postSeconds ?? 5}s after as a new clip`}
                            onClick={async () => {
                              const pre = settings?.capture.preSeconds ?? 20
                              const post = Math.max(3, settings?.capture.postSeconds ?? 5)
                              setBusy(true)
                              try {
                                const out = await window.cf.library.trim(clip.id, Math.max(0, b - pre), Math.min(duration || clip.durationSec, b + post), 'new')
                                if (out) {
                                  await window.cf.library.update(out.id, { title: `${clip.game === 'Desktop' ? 'Moment' : clip.game} · bookmark ${i + 1}` })
                                  toast.push({ kind: 'success', title: `Bookmark ${i + 1} saved as a clip`, action: { label: 'Open', onClick: () => openClip(out.id) } })
                                }
                              } catch (e) {
                                toast.push({ kind: 'error', title: 'Could not make the clip', body: String((e as Error)?.message ?? e) })
                              } finally {
                                setBusy(false)
                              }
                            }}
                          >
                            Make clip
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
