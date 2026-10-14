import { useEffect, useState } from 'react'
import { Film, LayoutDashboard, Monitor, PanelLeftClose, PanelLeftOpen, Pause, Play, Search, Settings as SettingsIcon, Sparkles, Square, UploadCloud, Zap } from 'lucide-react'
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
      <button onClick={onClick} title={`${label} (${k})`} className={`no-drag shrink-0 flex items-center gap-1.5 h-7 px-2 rounded-full text-[12px] whitespace-nowrap transition-colors ${active ? 'text-ink bg-white/10' : 'text-ink-2 hover:text-ink hover:bg-white/[0.07]'}`}>
        {k.split('+').map((p) => <kbd key={p} className="kbd h-5 min-w-5 text-[9px]">{p}</kbd>)}
        {/* Narrow windows keep just the keys; the label stays in the tooltip. */}
        <span className={label.length > 6 ? 'max-[1180px]:hidden' : ''}>{label}</span>
      </button>
    ) : null
  return (
    <div className="flex items-center gap-1 ml-6 shrink-0">
      <span className={`flex items-center gap-2 h-7 px-3 rounded-full text-[12px] font-medium shrink-0 ${paused ? 'text-warn bg-warn/10' : long ? 'text-[#ff8aa1] bg-[#ff3b5c]/12' : status.running ? 'text-live bg-live/10' : 'text-ink-2 bg-white/[0.05]'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${paused ? 'bg-warn' : long ? 'bg-[#ff3b5c]' : status.running ? 'bg-live' : 'bg-ink-3'}`} />
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
    <div className="drag h-14 shrink-0 flex items-center pl-6 gap-2.5 select-none relative z-10">
      <StatusStrip />
      {live && <span className="sr-only">Recording</span>}
      <button
        onClick={onSearch}
        className="no-drag ml-auto mr-[150px] shrink min-w-[150px] flex items-center gap-2.5 h-9 w-[380px] max-w-[34vw] px-3.5 rounded-full text-[13px] text-ink-3 hover:text-ink-2 border border-white/15 hover:border-white/30 transition-colors"
        aria-label="Search (Ctrl+K)"
      >
        <Search size={15} />
        <span className="flex-1 text-left truncate">Search</span>
        <kbd className="kbd h-5 min-w-5 text-[10px]">Ctrl</kbd><kbd className="kbd h-5 min-w-5 text-[10px]">K</kbd>
      </button>
    </div>
  )
}

/** Hover label for the collapsed sidebar (the label is also the accessible name). */
function Tip({ label, hint, show }: { label: string; hint?: string; show: boolean }) {
  if (!show) return null
  return (
    <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
      <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-[#2a2a30] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.8)]">
        {label}
        {hint && <span className="text-ink-3 text-xs font-normal">{hint}</span>}
      </span>
    </span>
  )
}

/** Sidebar item: icon + label like a launcher; icon only (with a hover label) when collapsed. */
function NavItem({ label, hint, icon, active, collapsed, onClick }: { label: string; hint?: string; icon: ReactNode; active?: boolean; collapsed: boolean; onClick: () => void }) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={`w-full flex items-center gap-3.5 h-12 rounded-xl text-[15px] font-medium transition-colors ${collapsed ? 'justify-center px-0' : 'px-4'} ${active ? 'bg-white/[0.09] text-ink' : 'text-ink-2 hover:bg-white/[0.05] hover:text-ink'}`}
      >
        <span className="shrink-0">{icon}</span>
        {!collapsed && <span className="truncate">{label}</span>}
      </button>
      <Tip label={label} hint={hint} show={collapsed} />
    </div>
  )
}

/** Small square action button for the sidebar's recording controls. */
function ActionButton({ label, hint, onClick, primary, disabled, collapsed, children }: { label: string; hint?: string; onClick: () => void; primary?: boolean; disabled?: boolean; collapsed: boolean; children: ReactNode }) {
  return (
    <div className="relative group flex-1">
      <button aria-label={label} title={collapsed ? undefined : hint ? `${label} (${hint})` : label} disabled={disabled} onClick={onClick}
        className={`w-full h-10 ${primary ? 'btn-primary' : 'btn'} !px-0 !rounded-[10px]`}>
        {children}
      </button>
      <Tip label={label} hint={hint} show={collapsed} />
    </div>
  )
}

function Shell() {
  const { page, setPage, status, start, stop, clipNow, settings, game, viewerClipId, openClip } = useStore()
  const [searchOpen, setSearchOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('cf.sidebar.collapsed') === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('cf.sidebar.collapsed', collapsed ? '1' : '0') } catch { /* private mode */ } }, [collapsed])

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
  }, [settings?.app.effects])

  if (!settings) return <div className="h-full grid place-items-center text-ink-3"><Backdrop />Loading…</div>
  if (!settings.app.onboarded) return <><Backdrop /><Onboarding /></>

  const live = status.running
  const paused = !!status.paused
  const ready = live && status.bufferedSeconds !== undefined ? `${Math.min(status.bufferedSeconds, settings.capture.bufferSeconds)}s ready to clip` : undefined
  const stateText = paused ? 'Paused' : live ? 'Recording' : status.starting ? 'Starting…' : 'Standby'
  const gameIcon = game && game.isGame && game.icon ? `cf://file/${encodeURIComponent(game.icon.replace(/\\/g, '/'))}` : undefined
  return (
    <div className="h-full flex">
      <Backdrop live={live} />
      <aside className={`sidebar relative z-30 shrink-0 flex flex-col ${collapsed ? 'w-[76px] px-2.5' : 'w-[232px] px-3.5'} pb-3 transition-[width] duration-200`}>
        {/* Logo row doubles as a window drag handle */}
        <div className={`drag h-14 shrink-0 flex items-center ${collapsed ? 'justify-center' : 'px-3'}`}>
          <img src="./icon.png" alt="Clutch" title="Clutch" className="w-8 h-8" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
        </div>
        <nav className="flex flex-col gap-1 mt-4" aria-label="Main">
          {NAV.map(({ id, label, icon: Icon, key }) => (
            <NavItem key={id} label={label} hint={`Ctrl+${key}`} active={page === id} collapsed={collapsed} onClick={() => setPage(id)} icon={<Icon size={20} />} />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          {/* What Clutch is doing, and the controls for it */}
          <div className={`rounded-xl bg-white/[0.04] ${collapsed ? 'p-1.5' : 'p-3'} flex flex-col gap-2.5`}>
            <button onClick={() => setPage('dashboard')} className={`relative group flex items-center gap-3 text-left ${collapsed ? 'justify-center py-1' : ''}`} aria-label={`${stateText}${game ? ` · ${game.name}` : ''}`}>
              <span className="relative grid place-items-center w-9 h-9 rounded-lg bg-white/[0.06] shrink-0">
                {game && !game.isGame ? <Monitor size={17} className="text-ink-2" /> : game ? <GameIcon src={gameIcon} name={game.name} size={22} /> : <Monitor size={17} className="text-ink-3" />}
                <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--color-sidebar)] ${paused || status.starting ? 'bg-warn' : live ? 'bg-[#ff3b5c]' : 'bg-ink-3'}`} />
              </span>
              {!collapsed && (
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-ink truncate">{stateText}</span>
                  <span className="block text-[12px] text-ink-3 truncate">{status.recordingBlocked ? 'Not clipping here' : ready ?? (game ? game.name : 'Waiting for a game')}</span>
                </span>
              )}
              <Tip label={`${stateText}${game ? ` · ${game.name}` : ''}`} hint={ready ?? status.recordingBlocked} show={collapsed} />
            </button>
            <div className={`flex gap-1.5 ${collapsed ? 'flex-col' : ''}`}>
              {live || paused ? (
                <>
                  {paused ? (
                    <ActionButton label="Resume recording" onClick={() => void window.cf.buffer.togglePause()} primary collapsed={collapsed}><Play size={17} /></ActionButton>
                  ) : (
                    <>
                      <ActionButton label="Clip now" hint={settings.capture.clipHotkey || undefined} onClick={() => void clipNow()} primary collapsed={collapsed}><Zap size={17} /></ActionButton>
                      <ActionButton label="Pause recording" onClick={() => void window.cf.buffer.togglePause()} collapsed={collapsed}><Pause size={16} /></ActionButton>
                    </>
                  )}
                  <ActionButton label="Stop recording" onClick={() => void stop()} collapsed={collapsed}><Square size={14} /></ActionButton>
                </>
              ) : (
                <ActionButton label={status.starting ? 'Starting…' : 'Start recording'} onClick={() => void start()} primary disabled={status.starting} collapsed={collapsed}>
                  <Play size={17} />{!collapsed && <span className="text-[13px] font-semibold">Start recording</span>}
                </ActionButton>
              )}
            </div>
          </div>
          <div className="relative group">
            <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className={`h-10 rounded-xl text-ink-3 hover:text-ink hover:bg-white/[0.05] transition-colors flex items-center gap-3 ${collapsed ? 'w-full justify-center' : 'px-4 w-full'}`}>
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              {!collapsed && <span className="text-[13px]">Collapse</span>}
            </button>
            <Tip label="Expand sidebar" show={collapsed} />
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <TitleBar live={live} onSearch={() => setSearchOpen(true)} />
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[1680px] mx-auto px-6 pt-2 pb-8 fade-in" key={page}>
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
