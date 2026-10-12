import { useEffect, useRef, useState } from 'react'
import { Gamepad2, Loader2, RefreshCw } from 'lucide-react'
import type { RunningApp } from '../../../shared/types'
import { fileUrl } from '../lib/store'
import { useToast } from './Toasts'
import { GameIcon } from './ui'

/**
 * "Already playing?" Point Clutch at a game that is open, even if it was started before Clutch or
 * Clutch didn't recognize it. Games are listed first; picking any app also marks it as a game.
 */
export function PickGame({ className = '' }: { className?: string }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [apps, setApps] = useState<RunningApp[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const load = async () => {
    setApps(null)
    const list = await window.cf.system.runningApps()
    setApps(list.filter((a) => !/^(electron|clutch)$/i.test(a.process)).sort((a, b) => Number(!!b.isGame) - Number(!!a.isGame)))
  }
  useEffect(() => { if (open) void load() }, [open])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [open])

  const pick = async (a: RunningApp) => {
    setBusy(a.process)
    try {
      const st = await window.cf.buffer.useGame(a)
      setOpen(false)
      if (st.recordingBlocked) toast.push({ kind: 'error', title: 'Not recording', body: st.recordingBlocked })
      else toast.push({ kind: 'success', title: `Recording ${st.game ?? a.process}`, body: 'Clutch keeps recording it while it runs, even when you use other windows.' })
    } finally {
      setBusy(null)
    }
  }

  const name = (a: RunningApp) => (a.title && a.title.length < 48 ? a.title.replace(/\s+[-–|].*$/, '') : a.process)

  return (
    <div ref={box} className={`relative ${className}`}>
      <button className="btn h-11 px-5" onClick={() => setOpen(!open)} aria-expanded={open} title="Record a game that's already open">
        <Gamepad2 size={16} /> Pick a game
      </button>
      {open && (
        <div className="absolute z-40 left-0 top-12 w-[360px] rounded-2xl border border-white/10 shadow-[var(--shadow-pop)] p-2" style={{ background: 'linear-gradient(160deg, rgba(22,30,48,0.98), rgba(10,14,24,0.98))' }} role="menu">
          <div className="flex items-center justify-between px-2 pt-1 pb-2">
            <span className="text-xs text-ink-3">Open windows. Pick the game to record.</span>
            <button className="btn-ghost h-7 w-7 grid place-items-center rounded-lg" onClick={() => void load()} aria-label="Refresh list"><RefreshCw size={13} /></button>
          </div>
          <div className="max-h-[320px] overflow-y-auto space-y-0.5">
            {apps === null && <p className="px-3 py-4 text-sm text-ink-3 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Looking at open windows…</p>}
            {apps?.length === 0 && <p className="px-3 py-4 text-sm text-ink-3">No open windows found.</p>}
            {apps?.map((a) => (
              <button key={a.process} role="menuitem" onClick={() => void pick(a)} disabled={!!busy}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-white/[0.07] transition-colors disabled:opacity-50">
                <GameIcon src={a.icon ? fileUrl(a.icon) : undefined} name={a.process} size={22} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-ink truncate">{name(a)}</span>
                  <span className="block text-[11px] text-ink-3 truncate">{a.process}</span>
                </span>
                {busy === a.process ? <Loader2 size={14} className="animate-spin text-ink-3" /> : a.isGame && <span className="text-[10px] font-hud tracking-[0.14em] text-accent">GAME</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
