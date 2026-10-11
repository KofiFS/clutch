import { useEffect, useState } from 'react'

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

function ensure() {
  if (started) return
  started = true
  window.cf.on('levels', (l: Levels) => {
    latest = { ...l, sources: { ...(latest?.sources ?? {}), ...l.sources } }
    lastAt = Date.now()
    for (const s of subs) s(latest)
  })
  // Levels stop arriving when recording stops; clear meters after a moment.
  setInterval(() => {
    if (latest && Date.now() - lastAt > 1500) {
      latest = null
      for (const s of subs) s(null)
    }
  }, 700)
}

/**
 * Live audio levels (~10 per second) without going through the global store, so only the
 * meters re-render instead of the whole app.
 */
export function useLevels(): Levels | null {
  const [l, setL] = useState<Levels | null>(latest)
  useEffect(() => {
    ensure()
    subs.add(setL)
    return () => { subs.delete(setL) }
  }, [])
  return l
}
