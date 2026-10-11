import { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark, Check, Maximize2, Minimize2, Pause, Play, Square, SquareArrowOutUpRight, Zap } from 'lucide-react'
import type { BufferStatus, Settings } from '../../shared/types'
import { useLevels } from './lib/levels'

/**
 * Corner recording controller. Lives in its own small always-on-top window that screen capture
 * can't see, so it never ends up in a clip.
 *
 * Compact: state, timer, Clip / Pause / Stop / Expand. Double-click (or the expand button) opens a
 * panel with a still from the actual recording, what is being captured and live audio.
 */
export default function MiniWidget() {
  const [status, setStatus] = useState<BufferStatus>({ running: false })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    void window.cf.buffer.status().then(setStatus)
    void window.cf.settings.get().then(setSettings)
    const offs = [
      window.cf.on('status', (s: BufferStatus) => setStatus(s)),
      window.cf.on('settings-changed', (s: Settings) => setSettings(s)),
      window.cf.on('mini-expanded', (on: boolean) => setExpanded(on)),
      window.cf.on('clip-saved', () => {
        setSaving('saved')
        window.setTimeout(() => setSaving('idle'), 2200)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // One tick a second for the timer (no CSS animation loops).
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const paused = !!status.paused
  const long = status.longRecording
  const since = status.since ? Date.parse(status.since) : 0
  const until = paused ? Date.parse(status.paused!.since) : now
  const elapsed = since ? Math.max(0, Math.floor((until - since) / 1000)) : 0

  const toggleExpand = useCallback(() => {
    void window.cf.mini.expand().then(setExpanded)
  }, [])

  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }
  const clip = () => {
    if (saving === 'saving') return
    setSaving('saving')
    void window.cf.buffer.clipNow().then((c) => { if (!c) setSaving('idle') })
  }

  const drag = useDrag()
  const stateLabel = status.starting ? 'Starting' : paused ? 'Paused' : long ? 'Long rec' : 'Rec'
  const tone = paused ? 'paused' : status.starting ? 'starting' : 'rec'
  const sub = paused
    ? 'Nothing is being recorded'
    : status.gameInfo?.isGame ? status.game : status.areaLabel ?? 'Recording'

  return (
    <div className="h-screen w-screen p-2 select-none">
      <div
        className="mini-panel h-full w-full flex flex-col overflow-hidden"
        onPointerDown={drag.down}
        onPointerMove={drag.move}
        onPointerUp={drag.up}
        onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) toggleExpand() }}
        title={expanded ? undefined : 'Double-click to check what is being recorded'}
      >
        {/* Header row (the whole compact widget) */}
        <div className="flex items-center gap-2.5 h-[60px] pl-4 pr-2.5 shrink-0">
          <span className={`mini-dot ${tone}`} aria-hidden />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-baseline gap-2">
              <span className={`font-hud text-[10px] uppercase tracking-[0.16em] ${paused ? 'text-warn' : 'text-[#ff8aa1]'}`}>{stateLabel}</span>
              <span className="font-hud text-[15px] tabular text-ink">{fmt(elapsed)}</span>
            </div>
            <div className="text-[11px] text-ink-3 truncate">{sub}</div>
          </div>
          <MiniButton label={saving === 'saved' ? 'Clip saved' : saving === 'saving' ? 'Saving clip…' : 'Clip the last moments'} onClick={clip} tone="accent" disabled={status.starting}>
            {saving === 'saved' ? <Check size={16} /> : <Zap size={16} className={saving === 'saving' ? 'opacity-50' : ''} />}
          </MiniButton>
          <MiniButton label={paused ? 'Resume recording' : 'Pause recording'} onClick={() => void act(() => window.cf.buffer.togglePause())} disabled={busy || status.starting} tone={paused ? 'warn' : undefined}>
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </MiniButton>
          <MiniButton label={long ? 'Stop and save the long recording' : 'Stop recording'} onClick={() => void act(() => window.cf.buffer.stop())} disabled={busy} tone="bad">
            <Square size={14} fill="currentColor" />
          </MiniButton>
          <MiniButton label={expanded ? 'Make smaller' : 'Check what is being recorded'} onClick={toggleExpand}>
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </MiniButton>
        </div>

        {expanded && <Details status={status} settings={settings} paused={paused} now={now} />}
      </div>
    </div>
  )
}

function Details({ status, settings, paused, now }: { status: BufferStatus; settings: Settings | null; paused: boolean; now: number }) {
  const preview = usePreview(true)
  const levels = useLevels()
  const sources = (settings?.capture.audioSources ?? []).filter((s) => s.enabled)
  const long = status.longRecording
  const buffered = Math.min(status.bufferedSeconds ?? 0, settings?.capture.bufferSeconds ?? 0)
  const ago = preview ? Math.max(0, Math.round((now - preview.atMs) / 1000)) : 0

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 px-4 pb-4">
      <div className="relative rounded-xl overflow-hidden bg-black/60 border border-white/[0.06] aspect-video">
        {preview ? (
          <img src={preview.dataUrl} alt="Latest frame from the recording" className={`w-full h-full object-contain ${paused ? 'opacity-40' : ''}`} draggable={false} />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[11px] text-ink-3 px-6 text-center">
            {paused ? 'Paused. The preview comes back when you resume.' : 'The first preview shows up a few seconds after recording starts.'}
          </div>
        )}
        {paused && preview && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="flex items-center gap-1.5 px-3 h-7 rounded-full bg-black/70 text-warn text-[12px] font-medium"><Pause size={13} /> Paused</span>
          </div>
        )}
        {preview && !paused && (
          <span className="absolute left-2 bottom-2 px-2 h-5 rounded-full bg-black/65 text-[10px] text-ink-2 flex items-center">From the recording · {ago <= 3 ? 'just now' : `${ago}s ago`}</span>
        )}
      </div>

      <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-[11.5px]">
        <dt className="text-ink-3">Capturing</dt>
        <dd className="text-ink-2 truncate">{status.areaLabel ?? 'Full screen'}</dd>
        <dt className="text-ink-3">Video</dt>
        <dd className="text-ink-2 truncate tabular">{status.resolution ? `${status.resolution} · ${status.fps ?? '?'} fps · ${encoderName(status.encoder)}` : '--'}</dd>
        <dt className="text-ink-3">{long ? 'Long rec' : 'Buffer'}</dt>
        <dd className="text-ink-2 truncate tabular">{long ? `Keeping everything · ${long.bookmarks} bookmark${long.bookmarks === 1 ? '' : 's'}` : paused ? 'Kept while paused' : `${buffered}s of ${settings?.capture.bufferSeconds ?? '?'}s ready`}</dd>
      </dl>

      <div className="flex flex-col gap-1.5">
        {sources.map((s) => (
          <MiniMeter key={s.id} label={s.name} db={paused ? undefined : s.kind === 'desktop' ? levels?.sysDb : levels?.sources[s.id]} />
        ))}
        {!sources.length && <p className="text-[11px] text-ink-3">No audio sources are on.</p>}
      </div>

      <div className="mt-auto flex items-center gap-2">
        <button className="mini-wide" onClick={() => void window.cf.mini.openMain()}>
          <SquareArrowOutUpRight size={14} /> Open Clutch
        </button>
        {long ? (
          <button className="mini-wide" onClick={() => void window.cf.buffer.bookmark()} disabled={paused}>
            <Bookmark size={14} /> Bookmark
          </button>
        ) : (
          <button className="mini-wide" onClick={() => void window.cf.buffer.toggleLong()} title="Keep everything from now until you stop, as one file">
            <span className="w-2 h-2 rounded-full bg-[#ff3b5c]" /> Long recording
          </button>
        )}
      </div>
    </div>
  )
}

function MiniButton({ children, label, onClick, disabled, tone }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; tone?: 'accent' | 'warn' | 'bad' }) {
  return (
    <button type="button" className={`mini-btn ${tone ?? ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled} onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </button>
  )
}

/** Small LED-style meter sized for the widget. */
function MiniMeter({ label, db }: { label: string; db?: number }) {
  const SEG = 22
  const lit = db === undefined ? 0 : Math.round(Math.max(0, Math.min(1, (db + 60) / 60)) * SEG)
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[86px] truncate text-[11px] text-ink-3" title={label}>{label}</span>
      <div className="flex-1 flex gap-[2px] h-2.5" aria-label={`${label} level`}>
        {Array.from({ length: SEG }, (_, i) => {
          const c = i >= SEG - 2 ? '255,107,139' : i >= SEG - 6 ? '255,200,87' : '79,227,255'
          return <span key={i} className="flex-1 rounded-[2px]" style={{ background: i < lit ? `rgba(${c},0.95)` : 'rgba(255,255,255,0.06)' }} />
        })}
      </div>
    </div>
  )
}

/** Poll a still from the newest finished segment while the panel is open. */
function usePreview(on: boolean) {
  const [p, setP] = useState<{ dataUrl: string; atMs: number } | null>(null)
  useEffect(() => {
    if (!on) return
    let alive = true
    const tick = async () => {
      const r = await window.cf.mini.preview().catch(() => null)
      if (alive && r) setP(r)
    }
    void tick()
    const t = window.setInterval(() => void tick(), 2500)
    return () => { alive = false; window.clearInterval(t) }
  }, [on])
  return p
}

/** Move the window by dragging anywhere that isn't a button. A small threshold keeps double-clicks working. */
function useDrag() {
  const st = useRef<{ x: number; y: number; moving: boolean; raf: number } | null>(null)
  return {
    down: (e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      st.current = { x: e.screenX, y: e.screenY, moving: false, raf: 0 }
    },
    move: (e: React.PointerEvent) => {
      const s = st.current
      if (!s) return
      if (!s.moving) {
        if (Math.hypot(e.screenX - s.x, e.screenY - s.y) < 4) return
        s.moving = true
        window.cf.mini.drag('start')
      }
      if (!s.raf) s.raf = requestAnimationFrame(() => { if (st.current) st.current.raf = 0; window.cf.mini.drag('move') })
    },
    up: (e: React.PointerEvent) => {
      const s = st.current
      st.current = null
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* not captured */ }
      if (s?.moving) { if (s.raf) cancelAnimationFrame(s.raf); window.cf.mini.drag('move'); window.cf.mini.drag('end') }
    }
  }
}

function fmt(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function encoderName(e?: string) {
  if (!e) return '?'
  if (e.includes('nvenc')) return `NVIDIA ${e.startsWith('hevc') ? 'HEVC' : e.startsWith('av1') ? 'AV1' : 'H.264'}`
  if (e.includes('amf')) return 'AMD'
  if (e.includes('qsv')) return 'Intel'
  return 'CPU'
}
