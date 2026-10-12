import { useEffect, useState } from 'react'
import type { AudioSource, BufferStatus, Settings } from '../../../shared/types'
import { startMeter } from './loopback'

export interface Levels {
  micDb: number
  sysDb: number
  /** Per-source levels keyed by audio source id (mics only; system audio is `sysDb`). */
  sources: Record<string, number>
}

let latest: Levels | null = null
let lastAt = 0
const subs = new Set<(l: Levels | null) => void>()
let started = false
let recording = false

const publish = (l: Levels | null) => { latest = l; for (const s of subs) s(l) }

function ensure() {
  if (started) return
  started = true
  // While recording, levels come from the recorder (~10 a second).
  window.cf.on('levels', (l: Levels) => {
    lastAt = Date.now()
    publish({ ...l, sources: { ...(latest?.sources ?? {}), ...l.sources } })
  })
  const onStatus = (s: BufferStatus) => {
    const was = recording
    recording = s.running
    if (recording !== was) syncMonitor()
  }
  window.cf.on('status', onStatus)
  void window.cf.buffer.status().then(onStatus)
  window.cf.on('settings-changed', (s: Settings) => {
    const sig = sourcesSig(s.capture.audioSources)
    if (sig !== monitorSig) { stopMonitor(); syncMonitor() }
  })
  document.addEventListener('visibilitychange', syncMonitor)
  // Recorder levels stop when recording stops; clear meters after a moment unless monitoring.
  setInterval(() => {
    if (latest && !monitor && Date.now() - lastAt > 1500) publish(null)
  }, 700)
}

// ---- Listening without recording, so the meters always move while you look at them.

let monitor: { stops: (() => void)[]; timer: ReturnType<typeof setInterval> } | null = null
let monitorSig = ''
let starting = false
const sourcesSig = (list: AudioSource[] = []) => JSON.stringify(list.filter((x) => x.enabled && x.kind !== 'app').map((x) => [x.id, x.kind, x.device, x.trigger]))

function syncMonitor() {
  const want = subs.size > 0 && !recording && document.visibilityState === 'visible'
  if (want && !monitor) void startMonitor()
  else if (!want && monitor) stopMonitor()
}

async function startMonitor() {
  if (starting || monitor) return
  starting = true
  try {
    const settings = await window.cf.settings.get()
    const sources = (settings.capture.audioSources ?? []).filter((x) => x.enabled && x.kind !== 'app')
    monitorSig = sourcesSig(settings.capture.audioSources)
    const local: Levels = { micDb: -100, sysDb: -100, sources: {} }
    const stops: (() => void)[] = []
    for (const src of sources) {
      try {
        if (src.kind === 'desktop') stops.push(await startMeter('system', (db) => { local.sysDb = db }))
        else if (src.kind === 'mic' && src.device) stops.push(await startMeter('mic', (db) => { local.sources[src.id] = db }, src.device))
      } catch { /* device busy or missing: that meter just stays empty */ }
    }
    // Lost the race with recording starting or the page closing: undo.
    if (subs.size === 0 || recording || document.visibilityState !== 'visible') { stops.forEach((s) => s()); return }
    const triggerIds = sources.filter((x) => x.kind === 'mic' && x.trigger !== false).map((x) => x.id)
    const timer = setInterval(() => {
      if (recording) return
      local.micDb = Math.max(-100, ...triggerIds.map((id) => local.sources[id] ?? -100))
      publish({ micDb: local.micDb, sysDb: local.sysDb, sources: { ...local.sources } })
    }, 100)
    monitor = { stops, timer }
  } finally {
    starting = false
  }
}

function stopMonitor() {
  if (!monitor) return
  clearInterval(monitor.timer)
  monitor.stops.forEach((s) => { try { s() } catch { /* already closed */ } })
  monitor = null
  if (!recording) publish(null)
}

/**
 * Live audio levels (~10 per second) without going through the global store, so only the
 * meters re-render instead of the whole app. Works whether or not Clutch is recording.
 */
export function useLevels(): Levels | null {
  const [l, setL] = useState<Levels | null>(latest)
  useEffect(() => {
    ensure()
    subs.add(setL)
    syncMonitor()
    return () => {
      subs.delete(setL)
      syncMonitor()
    }
  }, [])
  return l
}
