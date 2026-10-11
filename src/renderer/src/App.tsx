import { useEffect } from 'react'
import { Film, LayoutDashboard, Settings as SettingsIcon, Sparkles, UploadCloud, Zap } from 'lucide-react'
import { StoreProvider, useStore, type Page } from './lib/store'
import { ToastProvider } from './components/Toasts'
import { GameIcon, Kbd } from './components/ui'
import { ClipViewer } from './components/ClipViewer'
import { Backdrop } from './components/Backdrop'
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

function TitleBar({ live }: { live: boolean }) {
  return (
    <div className="drag h-11 shrink-0 flex items-center px-5 gap-2.5 select-none relative z-10">
      <img src="./icon.png" alt="" className="w-5 h-5 rounded-md" style={{ boxShadow: '0 0 12px rgba(79,227,255,0.6)' }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      <span className="font-hud text-[12px] font-bold tracking-[0.22em]">CLIPFORGE</span>
      <span className="font-hud text-[9px] text-ink-3 tracking-[0.2em] mt-px">BETA</span>
      {live && <span className="font-hud text-[9px] tracking-[0.2em] text-live ml-3 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-live pulse-dot" />REC</span>}
    </div>
  )
}

function Shell() {
  const { page, setPage, status, start, stop, clipNow, settings, game, viewerClipId, openClip } = useStore()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  return (
    <div className="h-full flex flex-col">
      <Backdrop live={live} />
      <TitleBar live={live} />
      <div className="flex-1 flex min-h-0 px-3 pb-3 gap-3">
        <aside className="card w-[236px] shrink-0 flex flex-col">
          <nav className="relative z-[2] p-3 space-y-1">
            {NAV.map(({ id, label, icon: Icon, key }) => {
              const active = page === id
              return (
                <button
                  key={id}
                  onClick={() => setPage(id)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative w-full flex items-center gap-3 h-11 px-3.5 rounded-full text-sm font-medium transition-all duration-200 group ${active ? 'text-ink liquid' : 'text-ink-2 hover:text-ink hover:bg-white/[0.06]'}`}
                  style={active ? { background: 'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06))', boxShadow: 'inset 0 1px 0.5px rgba(255,255,255,0.55), inset 0 -1px 0.5px rgba(255,255,255,0.08), 0 8px 24px -12px rgba(0,0,0,0.8), 0 0 22px -8px rgba(79,227,255,0.7)' } : undefined}
                >
                  <Icon size={17} className={active ? 'text-accent drop-shadow-[0_0_6px_rgba(79,227,255,0.9)]' : 'text-ink-3 group-hover:text-ink-2'} />
                  <span className="flex-1 text-left">{label}</span>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity"><Kbd>⌃{key}</Kbd></span>
                </button>
              )
            })}
          </nav>

          <div className="relative z-[2] mt-auto p-3 space-y-2.5">
            <div className={`card-2 p-3.5 space-y-2.5 transition-shadow ${live ? 'shadow-[0_0_30px_-10px_rgba(79,227,255,0.7)]' : ''}`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${live ? 'bg-live pulse-dot text-live shadow-[0_0_8px_#4fe3ff]' : status.starting ? 'bg-warn' : 'bg-ink-3/50'}`} />
                <span className="font-hud text-[10px] font-medium tracking-[0.16em] uppercase">{live ? 'Recording' : status.starting ? 'Starting' : 'Standby'}</span>
                {live && status.bufferedSeconds !== undefined && <span className="ml-auto font-hud text-[10px] tabular text-ink-2">{Math.min(status.bufferedSeconds, settings.capture.bufferSeconds)}s</span>}
              </div>
              {game && (
                <div className="flex items-center gap-2 text-xs text-ink-2 min-w-0">
                  <GameIcon src={game.icon ? `cf://file/${encodeURIComponent(game.icon.replace(/\\/g, '/'))}` : undefined} name={game.name} size={18} />
                  <span className="truncate">{game.name}</span>
                  {game.isGame && <span className="ml-auto font-hud text-[9px] tracking-[0.16em] text-live">GAME</span>}
                </div>
              )}
              {status.recordingBlocked && <div className="text-[11px] text-warn leading-snug">{status.recordingBlocked}</div>}
            </div>
            {live ? (
              <>
                <button className="btn-live w-full h-11" onClick={() => void clipNow()}>
                  <Zap size={16} /> Clip now
                  {settings.capture.clipHotkey && <Kbd>{settings.capture.clipHotkey}</Kbd>}
                </button>
                <button className="btn w-full" onClick={() => void stop()}>Stop recording</button>
              </>
            ) : (
              <button className="btn-primary w-full h-11" disabled={status.starting} onClick={() => void start()}>
                {status.starting ? 'Starting…' : 'Start recording'}
              </button>
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
