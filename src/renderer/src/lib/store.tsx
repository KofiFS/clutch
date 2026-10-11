import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ActivityEvent, BufferStatus, Clip, GameInfo, Settings } from '../../../shared/types'
import { loopbackActive, startLoopback, stopLoopback } from './loopback'
import { useToast } from '../components/Toasts'

export type Page = 'dashboard' | 'library' | 'rules' | 'uploads' | 'settings'

interface Store {
  settings: Settings | null
  status: BufferStatus
  activity: ActivityEvent[]
  game: GameInfo | null
  libraryVersion: number
  uploadsVersion: number
  page: Page
  setPage: (p: Page) => void
  /** Clip currently open in the viewer, if any. */
  viewerClipId: string | null
  openClip: (id: string | null) => void
  save: (patch: Partial<Settings>) => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  clipNow: () => Promise<void>
  loopbackError: string | null
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<BufferStatus>({ running: false })
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [game, setGame] = useState<GameInfo | null>(null)
  const [libraryVersion, setLib] = useState(0)
  const [uploadsVersion, setUp] = useState(0)
  const [page, setPage] = useState<Page>('dashboard')
  const [viewerClipId, openClip] = useState<string | null>(null)
  const [loopbackError, setLoopbackError] = useState<string | null>(null)
  const toast = useToast()
  const settingsRef = useRef<Settings | null>(null)
  settingsRef.current = settings

  useEffect(() => {
    void window.cf.settings.get().then(setSettings)
    void window.cf.buffer.status().then((s) => { setStatus(s); if (s.gameInfo) setGame(s.gameInfo) })
    void window.cf.activity.list().then(setActivity)
    const offs = [
      window.cf.on('status', (s: BufferStatus) => { setStatus(s); if (s.gameInfo) setGame(s.gameInfo) }),
      window.cf.on('activity', (ev: ActivityEvent) => {
        setActivity((a) => [ev, ...a].slice(0, 300))
        if (ev.kind === 'error') toast.push({ kind: 'error', title: 'Something went wrong', body: ev.message, ms: 8000 })
      }),
      window.cf.on('game', (g: GameInfo) => setGame(g)),
      window.cf.on('library-changed', () => setLib((v) => v + 1)),
      window.cf.on('uploads-changed', () => setUp((v) => v + 1)),
      window.cf.on('clip-saved', (clip: Clip) => {
        toast.push({ kind: 'clip', title: 'Clipped!', body: `${clip.title} · ${Math.round(clip.durationSec)}s`, action: { label: 'View', onClick: () => openClip(clip.id) } })
        if (settingsRef.current?.app.clipSound) playClipSound()
      }),
      window.cf.on('settings-changed', (s: Settings) => setSettings(s)),
      window.cf.on('open-clip', (id: string) => openClip(id)),
      window.cf.on('navigate', (p: Page) => { openClip(null); setPage(p) }),
      window.cf.on('clip-of-the-day', (clip: Clip) => {
        toast.push({ kind: 'clip', title: 'Your clip of the day', body: `${clip.title} · ${clip.game}`, action: { label: 'Watch', onClick: () => openClip(clip.id) }, ms: 10000 })
      }),
      window.cf.on('upload-done', (u: { clipId: string; url?: string; title: string }) => {
        toast.push({ kind: 'success', title: 'Uploaded to YouTube', body: u.title, action: u.url ? { label: 'Open', onClick: () => void window.cf.system.openExternal(u.url!) } : undefined })
      })
    ]
    return () => offs.forEach((off) => off())
  }, [toast])

  // Auto-started recordings (game detected) need the loopback too; start it when the buffer comes up.
  useEffect(() => {
    if (!settings) return
    if (status.running && settings.capture.systemAudio && !loopbackActive()) {
      startLoopback().then(() => setLoopbackError(null)).catch((e) => setLoopbackError(String(e?.message ?? e)))
    } else if (!status.running && loopbackActive()) {
      stopLoopback()
    }
  }, [status.running, settings])

  const save = useCallback(async (patch: Partial<Settings>) => setSettings(await window.cf.settings.set(patch)), [])
  const start = useCallback(async () => {
    // Loopback must be set up *before* FFmpeg opens desktop duplication: Chromium's screen-capture
    // setup briefly grabs the same DXGI output and would kill a running capture.
    const s = await window.cf.settings.get()
    if (s.capture.systemAudio && !loopbackActive()) {
      try { await startLoopback(); setLoopbackError(null) } catch (e) { setLoopbackError(String((e as Error)?.message ?? e)) }
    }
    await window.cf.buffer.start()
  }, [])
  const stop = useCallback(() => window.cf.buffer.stop(), [])
  const clipNow = useCallback(async () => { await window.cf.buffer.clipNow() }, [])

  const value = useMemo<Store>(
    () => ({ settings, status, activity, game, libraryVersion, uploadsVersion, page, setPage, viewerClipId, openClip, save, start, stop, clipNow, loopbackError }),
    [settings, status, activity, game, libraryVersion, uploadsVersion, page, viewerClipId, save, start, stop, clipNow, loopbackError]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider missing')
  return s
}

let audioCtx: AudioContext | null = null
/** Two-note "clipped" chime, synthesized so there is no asset to ship. */
function playClipSound() {
  try {
    audioCtx ??= new AudioContext()
    const ac = audioCtx
    const t = ac.currentTime
    for (const [freq, at] of [[880, 0], [1320, 0.09]] as const) {
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.type = 'sine'
      o.frequency.value = freq
      g.gain.setValueAtTime(0, t + at)
      g.gain.linearRampToValueAtTime(0.12, t + at + 0.01)
      g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.25)
      o.connect(g).connect(ac.destination)
      o.start(t + at)
      o.stop(t + at + 0.3)
    }
  } catch { /* no audio output */ }
}

export const fileUrl = (p: string) => `cf://file/${encodeURIComponent(p.replace(/\\/g, '/'))}`

export function fmtDuration(sec: number) {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function fmtTime(sec: number) {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}

export function fmtBytes(n: number) {
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`
  return `${Math.round(n / 1e3)} KB`
}

export function timeAgo(iso: string) {
  const d = (Date.now() - Date.parse(iso)) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

export function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
