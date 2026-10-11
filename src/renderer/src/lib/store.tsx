import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ActivityEvent, BufferStatus, Settings } from '../../../shared/types'
import { loopbackActive, startLoopback, stopLoopback } from './loopback'

interface Store {
  settings: Settings | null
  status: BufferStatus
  activity: ActivityEvent[]
  libraryVersion: number
  uploadsVersion: number
  save: (patch: Partial<Settings>) => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  clipNow: () => Promise<void>
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<BufferStatus>({ running: false })
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [libraryVersion, setLib] = useState(0)
  const [uploadsVersion, setUp] = useState(0)

  useEffect(() => {
    void window.cf.settings.get().then(setSettings)
    void window.cf.buffer.status().then(setStatus)
    void window.cf.activity.list().then(setActivity)
    const offs = [
      window.cf.on('status', (s: BufferStatus) => setStatus(s)),
      window.cf.on('activity', (ev: ActivityEvent) => setActivity((a) => [ev, ...a].slice(0, 300))),
      window.cf.on('library-changed', () => setLib((v) => v + 1)),
      window.cf.on('uploads-changed', () => setUp((v) => v + 1))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Stop the system-audio loopback whenever the buffer stops.
  useEffect(() => {
    if (!status.running && loopbackActive()) stopLoopback()
  }, [status.running])

  const save = useCallback(async (patch: Partial<Settings>) => setSettings(await window.cf.settings.set(patch)), [])
  const start = useCallback(async () => {
    // Loopback must be set up *before* FFmpeg opens desktop duplication: Chromium's screen-capture
    // setup briefly grabs the same DXGI output and would kill a running capture.
    const s = await window.cf.settings.get()
    if (s.capture.systemAudio && !loopbackActive()) {
      try { await startLoopback() } catch (e) { console.warn('System audio loopback unavailable', e) }
    }
    await window.cf.buffer.start()
  }, [])
  const stop = useCallback(() => window.cf.buffer.stop(), [])
  const clipNow = useCallback(async () => { await window.cf.buffer.clipNow() }, [])

  const value = useMemo(() => ({ settings, status, activity, libraryVersion, uploadsVersion, save, start, stop, clipNow }), [settings, status, activity, libraryVersion, uploadsVersion, save, start, stop, clipNow])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider missing')
  return s
}

export const fileUrl = (p: string) => `cf://file/${encodeURIComponent(p.replace(/\\/g, '/'))}`

export function fmtDuration(sec: number) {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
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
