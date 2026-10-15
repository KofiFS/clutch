import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDownToLine, BookOpen, Bug, CircleHelp, ExternalLink, Keyboard, ListChecks, Loader2, RefreshCw, Sparkles, Stethoscope } from 'lucide-react'
import { useStore } from '../lib/store'
import { Kbd, Modal } from './ui'

const REPO = 'https://github.com/KofiFS/clutch'

/** A small panel under a top-bar button; closes on outside click or Esc. */
function Popover({ open, onClose, children, width = 'w-80' }: { open: boolean; onClose: () => void; children: ReactNode; width?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key) }
  }, [open, onClose])
  if (!open) return null
  return (
    <div ref={ref} className={`no-drag absolute right-0 top-[calc(100%+8px)] z-50 ${width} rounded-2xl bg-[#1f1f24] border border-white/10 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)] p-2 pop-in`}>
      {children}
    </div>
  )
}

const iconBtn = 'no-drag relative h-9 w-9 grid place-items-center rounded-full transition-colors'

/** Discord-style update arrow: green when an update is ready (one click restarts into it). */
export function UpdateButton() {
  const { update: u, status } = useStore()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ready = u.phase === 'ready'
  const downloading = u.phase === 'downloading'
  const pct = Math.round((u.progress ?? 0) * 100)
  const when = u.checkedAt ? new Date(u.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
  const label = ready ? `Clutch ${u.version} is ready. Restart to update` : downloading ? `Downloading Clutch ${u.version}… ${pct}%` : 'Updates'
  const check = async () => { setBusy(true); try { await window.cf.updates.check() } finally { setBusy(false) } }
  return (
    <div className="relative">
      <button
        className={`${iconBtn} ${ready ? 'text-[#3ba55d] hover:bg-[#3ba55d]/15' : 'text-ink-3 hover:text-ink hover:bg-white/[0.07]'}`}
        onClick={() => (ready ? void window.cf.updates.install() : setOpen(!open))}
        aria-label={label}
        title={label}
      >
        {downloading ? <Loader2 size={18} className="animate-spin text-accent" /> : <ArrowDownToLine size={18} strokeWidth={ready ? 2.6 : 2} />}
        {ready && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#3ba55d] ring-2 ring-[var(--color-bg)]" />}
      </button>
      <Popover open={open && !ready} onClose={() => setOpen(false)}>
        <div className="px-3 pt-2 pb-3 space-y-2">
          <div className="text-sm font-semibold">Clutch {u.current}</div>
          <p className="text-xs text-ink-3 leading-relaxed">
            {u.phase === 'unsupported' ? u.message
              : u.phase === 'checking' || busy ? 'Checking for a new version…'
              : downloading ? `Downloading Clutch ${u.version}… ${pct}%. It installs when you restart.`
              : u.phase === 'up-to-date' ? `You're on the newest version${when ? ` (checked ${when})` : ''}.`
              : u.phase === 'error' ? u.message
              : 'Clutch checks for updates by itself and never restarts on its own.'}
          </p>
          {downloading && <div className="h-1 rounded-full bg-white/[0.08] overflow-hidden"><div className="h-full bg-accent rounded-full transition-[width]" style={{ width: `${pct}%` }} /></div>}
          <div className="flex gap-2 pt-1">
            <button className="btn-sm flex-1" disabled={busy || u.phase === 'unsupported' || u.phase === 'checking' || downloading} onClick={() => void check()}>
              <RefreshCw size={13} className={busy || u.phase === 'checking' ? 'animate-spin' : ''} /> Check for updates
            </button>
            <button className="btn-sm" onClick={() => void window.cf.system.openExternal(`${REPO}/releases`)}>What's new</button>
          </div>
          {status.running && <p className="text-[11px] text-ink-3">Updating restarts Clutch, which stops the current recording.</p>}
        </div>
      </Popover>
    </div>
  )
}

/** "?" menu: guide, shortcuts, what's new, bug reports, health check. */
export function HelpButton() {
  const { goTo, update } = useStore()
  const [open, setOpen] = useState(false)
  const [keys, setKeys] = useState(false)
  const go = (fn: () => void) => () => { setOpen(false); fn() }
  const web = (url: string) => go(() => void window.cf.system.openExternal(url))
  const items: { icon: ReactNode; label: string; sub?: string; run: () => void; external?: boolean }[] = [
    { icon: <BookOpen size={16} />, label: 'Clutch guide', sub: 'How everything works', run: web(`${REPO}/blob/main/docs/GUIDE.md`), external: true },
    { icon: <Keyboard size={16} />, label: 'Keyboard shortcuts', run: go(() => setKeys(true)) },
    { icon: <ListChecks size={16} />, label: 'Setup checklist', run: go(() => goTo('settings', 'Setup')) },
    { icon: <Stethoscope size={16} />, label: 'Health check', sub: "When something isn't working", run: go(() => goTo('settings', 'Health check')) },
    { icon: <Sparkles size={16} />, label: "What's new", run: web(`${REPO}/releases`), external: true },
    { icon: <Bug size={16} />, label: 'Report a bug or ask for a feature', run: web(`${REPO}/issues/new/choose`), external: true }
  ]
  return (
    <div className="relative">
      <button className={`${iconBtn} text-ink-3 hover:text-ink hover:bg-white/[0.07] ${open ? 'bg-white/[0.07] text-ink' : ''}`} onClick={() => setOpen(!open)} aria-label="Help" title="Help">
        <CircleHelp size={18} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} width="w-72">
        <ul>
          {items.map((it) => (
            <li key={it.label}>
              <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-white/[0.06] transition-colors" onClick={it.run}>
                <span className="text-ink-2 shrink-0">{it.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink">{it.label}</span>
                  {it.sub && <span className="block text-xs text-ink-3">{it.sub}</span>}
                </span>
                {it.external && <ExternalLink size={13} className="text-ink-3 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="px-3 pt-2 pb-1 mt-1 border-t border-white/[0.06] text-[11px] text-ink-3">Clutch {update.current} · free and open source</div>
      </Popover>
      <ShortcutsDialog open={keys} onClose={() => setKeys(false)} />
    </div>
  )
}

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings } = useStore()
  const c = settings?.capture
  const keys = (k?: string) => (k ? <span className="flex gap-1">{k.split('+').map((p) => <Kbd key={p}>{p}</Kbd>)}</span> : <span className="text-ink-3 text-xs">not set</span>)
  const groups: { title: string; rows: [string, ReactNode][] }[] = [
    { title: 'In game (work everywhere)', rows: [
      ['Save a clip', keys(c?.clipHotkey)],
      ['Start / stop long recording', keys(c?.longRecordHotkey)],
      ['Bookmark (during long recording)', keys(c?.bookmarkHotkey)],
      ['Longer clips', keys(c?.lengthUpHotkey)],
      ['Shorter clips', keys(c?.lengthDownHotkey)],
      ['Or just say', <span className="text-sm text-ink-2">“clip that”</span>]
    ] },
    { title: 'In Clutch', rows: [
      ['Search anything', keys('Ctrl+K')],
      ['Home / Clips / What to clip / Uploads / Settings', keys('Ctrl+1…5')],
      ['Search clips', keys('/')],
      ['Select all clips', keys('Ctrl+A')]
    ] },
    { title: 'Watching a clip', rows: [
      ['Play / pause', keys('Space')],
      ['Back / forward 1 s (Shift: 5 s)', keys('← →')],
      ['Previous / next clip', keys('[ ]')],
      ['Volume / mute', <span className="flex gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd><Kbd>M</Kbd></span>],
      ['Fullscreen', keys('F')],
      ['Favorite', keys('L')],
      ['Delete', keys('Del')],
      ['Close', keys('Esc')]
    ] }
  ]
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" width="max-w-lg">
      <div className="p-6 pt-2 space-y-5">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="label">{g.title}</div>
            <ul className="divide-y divide-white/[0.06]">
              {g.rows.map(([what, k]) => <li key={what} className="flex items-center justify-between gap-4 py-2 text-sm"><span className="text-ink-2">{what}</span>{k}</li>)}
            </ul>
          </div>
        ))}
        <p className="text-xs text-ink-3">Change the in-game keys under Settings → Clip hotkey.</p>
      </div>
    </Modal>
  )
}
