import { useEffect, useState } from 'react'
import { Film, LayoutDashboard, Monitor, Pause, Play, Search, Settings as SettingsIcon, Sparkles, Square, UploadCloud, Zap } from 'lucide-react'
import { StoreProvider, useStore, type Page } from './lib/store'
import { ToastProvider } from './components/Toasts'
import { GameIcon, Kbd } from './components/ui'
import type { ReactNode } from 'react'
import { ClipViewer } from './components/ClipViewer'
import { Backdrop } from './components/Backdrop'
import { CommandPalette } from './components/CommandPalette'
import { ProDialog, SignInDialog } from './components/Account'
import Dashboard from './pages/Dashboard'
import Library from './pages/Library'
import Rules from './pages/Rules'
import Uploads from './pages/Uploads'
import Settings from './pages/Settings'
import Onboarding from './pages/Onboarding'

const NAV: { id: Page; label: string; icon: typeof Film; key: string }[] = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard, key: '1' },
  { id: 'library', label: 'Clips', icon: Film, key: '2' },
  { id: 'rules', label: 'What to clip', icon: Sparkles, key: '3' },
  { id: 'uploads', label: 'Uploads', icon: UploadCloud, key: '4' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, key: '5' }
]

/** Medal-style status strip: what Clutch is doing right now and the keys that matter. */
function StatusStrip() {
  const { status, settings, game } = useStore()
  const [, tick] = useState(0)
  const long = status.longRecording
  useEffect(() => {
    if (!long) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [long])
  if (!settings) return null
  const c = settings.capture
  const elapsed = long ? Math.floor((Date.now() - Date.parse(long.since)) / 1000) : 0
  const hms = `${Math.floor(elapsed / 3600) ? `${Math.floor(elapsed / 3600)}:` : ''}${String(Math.floor((elapsed % 3600) / 60)).padStart(Math.floor(elapsed / 3600) ? 2 : 1, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const paused = !!status.paused
  const state = paused ? 'Paused · nothing is being recorded' : long ? `Long recording ${hms}` : status.running ? `Recording${game?.isGame ? ` · ${game.name}` : ''}` : status.starting ? 'Starting…' : 'Waiting for game'
  const Key = ({ k, label, onClick, active }: { k: string; label: string; onClick?: () => void; active?: boolean }) =>
    k ? (
      <button onClick={onClick} className={`no-drag flex items-center gap-1.5 h-7 px-2 rounded-full text-[12px] transition-colors ${active ? 'text-ink bg-white/10' : 'text-ink-2 hover:text-ink hover:bg-white/[0.07]'}`}>
        {k.split('+').map((p) => <kbd key={p} className="kbd h-5 min-w-5 text-[9px]">{p}</kbd>)}
        <span>{label}</span>
      </button>
    ) : null
  return (
    <div className="flex items-center gap-1 ml-6 min-w-0">
      <span className={`flex items-center gap-2 h-7 px-3 rounded-full text-[12px] font-medium shrink-0 ${paused ? 'text-warn bg-warn/10' : long ? 'text-[#ff8aa1] bg-[#ff3b5c]/12' : status.running ? 'text-live bg-live/10' : 'text-ink-2 bg-white/[0.05]'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${paused ? 'bg-warn' : long ? 'bg-[#ff3b5c] shadow-[0_0_8px_#ff3b5c]' : status.running ? 'bg-live shadow-[0_0_8px_#4fe3ff]' : 'bg-ink-3'}`} />
        <span className="tabular">{state}</span>
        {long && long.bookmarks > 0 && <span className="text-ink-3">· {long.bookmarks} bookmark{long.bookmarks > 1 ? 's' : ''}</span>}
      </span>
      {paused && (
        <button onClick={() => void window.cf.buffer.togglePause()} className="no-drag flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] font-medium text-[#1a1200] bg-warn hover:brightness-110 transition">
          <Play size={12} fill="currentColor" /> Resume
        </button>
      )}
      <Key k={c.clipHotkey} label="Clip" onClick={() => void window.cf.buffer.clipNow()} />
      <Key k={c.longRecordHotkey} label={long ? 'Stop long recording' : 'Long recording'} active={!!long} onClick={() => void window.cf.buffer.toggleLong()} />
      {long && <Key k={c.bookmarkHotkey} label="Bookmark" onClick={() => void window.cf.buffer.bookmark()} />}
    </div>
  )
}

function TitleBar({ live, onSearch }: { live: boolean; onSearch: () => void }) {
  return (
    <div className="drag h-11 shrink-0 flex items-center px-5 gap-2.5 select-none relative z-10">
      <img src="./icon.png" alt="" className="w-6 h-6" style={{ filter: "drop-shadow(0 0 8px rgba(40,140,255,0.7))" }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      <span className="font-hud text-[12px] font-bold tracking-[0.3em]">CLUTCH</span>
      <span className="font-hud text-[9px] text-ink-3 tracking-[0.2em] mt-px">BETA</span>
      <StatusStrip />
      {live && <span className="sr-only">Recording</span>}
      <button
        onClick={onSearch}
        className="no-drag ml-auto mr-[150px] flex items-center gap-2 h-8 w-[300px] max-w-[30vw] px-3 rounded-full text-[13px] text-ink-3 hover:text-ink-2 border border-white/12 transition-colors"
        style={{ background: 'rgba(0,10,25,0.4)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)' }}
        aria-label="Search (Ctrl+K)"
      >
        <Search size={14} />
        <span className="flex-1 text-left truncate">Search Clutch…</span>
        <kbd className="kbd h-5 min-w-5 text-[9px]">Ctrl</kbd><kbd className="kbd h-5 min-w-5 text-[9px]">K</kbd>
      </button>
    </div>
  )
}

/** Icon-only rail button with a glass tooltip to the right (label is also the accessible name). */
function RailButton({ label, hint, onClick, active, variant, disabled, children }: { label: string; hint?: string; onClick: () => void; active?: boolean; variant?: 'primary' | 'live'; disabled?: boolean; children: ReactNode }) {
  const base = variant === 'primary' ? 'btn-primary' : variant === 'live' ? 'btn-live' : ''
  return (
    <div className="relative group">
      <button
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        disabled={disabled}
        onClick={onClick}
        className={`grid place-items-center w-12 h-12 rounded-2xl transition-all duration-200 ${base ? `${base} !px-0 !h-12 !rounded-2xl` : active ? 'liquid' : 'hover:bg-white/[0.07]'}`}
        style={active && !base ? { background: 'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06))', boxShadow: 'inset 0 1px 0.5px rgba(255,255,255,0.55), inset 0 -1px 0.5px rgba(255,255,255,0.08), 0 8px 24px -12px rgba(0,0,0,0.8), 0 0 22px -8px rgba(79,227,255,0.7)' } : undefined}
      >
        {children}
      </button>
      <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 whitespace-nowrap opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 transition-all duration-150">
        <span className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[13px] font-medium border border-white/15 backdrop-blur-xl shadow-[var(--shadow-pop)]" style={{ background: "rgba(8,14,28,0.92)", boxShadow: "inset 0 1px 0.5px rgba(255,255,255,0.25), 0 12px 30px -10px rgba(0,0,0,0.9)" }}>
          {label}
          {hint && <span className="text-ink-3 text-xs font-normal">{hint}</span>}
        </span>
      </span>
    </div>
  )
}

function Shell() {
  const { page, setPage, status, start, stop, clipNow, settings, game, viewerClipId, openClip } = useStore()
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen((v) => !v); return }
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const nav = NAV.find((n) => n.key === e.key)
        if (nav) { e.preventDefault(); setPage(nav.id) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPage])

  // Visual effects level + OS window glass flags live on <html> so plain CSS can react.
  useEffect(() => {
    document.documentElement.dataset.fx = settings?.app.effects ?? 'full'
    document.documentElement.dataset.windowGlass = settings?.app.windowGlass ? 'on' : 'off'
  }, [settings?.app.effects, settings?.app.windowGlass])

  if (!settings) return <div className="h-full grid place-items-center text-ink-3"><Backdrop />Loading…</div>
  if (!settings.app.onboarded) return <><Backdrop /><Onboarding /></>

  const live = status.running
  const paused = !!status.paused
  return (
    <div className="h-full flex flex-col">
      <Backdrop live={live} />
      <TitleBar live={live} onSearch={() => setSearchOpen(true)} />
      <div className="flex-1 flex min-h-0 px-3 pb-3 gap-3">
        <aside className="card relative z-30 w-[76px] shrink-0 flex flex-col items-center py-3">
          <nav className="relative z-[2] flex flex-col items-center gap-1.5" aria-label="Main">
            {NAV.map(({ id, label, icon: Icon, key }) => {
              const active = page === id
              return (
                <RailButton key={id} label={label} hint={`Ctrl+${key}`} onClick={() => setPage(id)} active={active}>
                  <Icon size={20} className={active ? 'text-accent drop-shadow-[0_0_6px_rgba(79,227,255,0.9)]' : 'text-ink-2 group-hover:text-ink'} />
                </RailButton>
              )
            })}
          </nav>

          <div className="relative z-[2] mt-auto flex flex-col items-center gap-2.5">
            {/* Status orb: the current app/game, ringed by recording state */}
            <RailButton
              label={paused ? 'Recording paused' : live ? `Recording${game ? ` · ${game.name}` : ''}` : status.starting ? 'Starting…' : `Standby${game ? ` · ${game.name}` : ''}`}
              hint={live && status.bufferedSeconds !== undefined ? `${Math.min(status.bufferedSeconds, settings.capture.bufferSeconds)}s ready to clip` : status.recordingBlocked}
              onClick={() => setPage('dashboard')}
            >
              <span className={`relative grid place-items-center w-9 h-9 rounded-full ${paused ? 'ring-2 ring-warn' : live ? 'ring-2 ring-live shadow-[0_0_14px_-2px_#4fe3ff]' : status.starting ? 'ring-2 ring-warn' : 'ring-1 ring-white/15'}`}>
                {game && !game.isGame ? <Monitor size={18} className="text-ink-2" /> : game ? <GameIcon src={game.icon ? `cf://file/${encodeURIComponent(game.icon.replace(/\\/g, '/'))}` : undefined} name={game.name} size={22} /> : <span className="w-2 h-2 rounded-full bg-ink-3" />}
                {status.recordingBlocked && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-warn ring-2 ring-[#060a14]" />}
              </span>
            </RailButton>
            {live || paused ? (
              <>
                {paused ? (
                  <RailButton label="Resume recording" onClick={() => void window.cf.buffer.togglePause()} variant="primary">
                    <Play size={20} className="ml-0.5" />
                  </RailButton>
                ) : (
                  <>
                    <RailButton label="Clip now" hint={settings.capture.clipHotkey || undefined} onClick={() => void clipNow()} variant="live">
                      <Zap size={20} />
                    </RailButton>
                    <RailButton label="Pause recording" hint="Keeps what is recorded so far" onClick={() => void window.cf.buffer.togglePause()}>
                      <Pause size={17} className="text-ink-2 group-hover:text-ink" />
                    </RailButton>
                  </>
                )}
                <RailButton label="Stop recording" onClick={() => void stop()}>
                  <Square size={16} className="text-ink-2 group-hover:text-ink" />
                </RailButton>
              </>
            ) : (
              <RailButton label={status.starting ? 'Starting…' : 'Start recording'} onClick={() => void start()} variant="primary" disabled={status.starting}>
                <Play size={20} className="ml-0.5" />
              </RailButton>
            )}
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto rounded-[var(--radius-lg)]">
          <div className="max-w-[1180px] mx-auto px-5 py-4 fade-in" key={page}>
            {page === 'dashboard' && <Dashboard />}
            {page === 'library' && <Library />}
            {page === 'rules' && <Rules />}
            {page === 'uploads' && <Uploads />}
            {page === 'settings' && <Settings />}
          </div>
        </main>
      </div>
      {viewerClipId && <ClipViewer clipId={viewerClipId} onClose={() => openClip(null)} />}
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <SignInDialog />
      <ProDialog />
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </ToastProvider>
  )
}
