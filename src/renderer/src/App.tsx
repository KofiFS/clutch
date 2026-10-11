import { useEffect } from 'react'
import { Circle, Film, LayoutDashboard, Settings as SettingsIcon, Sparkles, UploadCloud, Zap } from 'lucide-react'
import { StoreProvider, useStore, type Page } from './lib/store'
import { ToastProvider } from './components/Toasts'
import { GameIcon, Kbd } from './components/ui'
import { ClipViewer } from './components/ClipViewer'
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

function TitleBar() {
  return (
    <div className="drag h-10 shrink-0 flex items-center px-4 gap-2 border-b border-line bg-surface-1 select-none">
      <img src="./icon.png" alt="" className="w-5 h-5 rounded-md" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      <span className="text-[13px] font-semibold tracking-tight">ClipForge</span>
      <span className="text-[11px] text-ink-3 ml-1">beta</span>
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

  if (!settings) return <div className="h-full grid place-items-center text-ink-3">Loading…</div>
  if (!settings.app.onboarded) return <Onboarding />

  const live = status.running
  return (
    <div className="h-full flex flex-col">
      <TitleBar />
      <div className="flex-1 flex min-h-0">
        <aside className="w-[232px] shrink-0 border-r border-line bg-surface-1 flex flex-col">
          <nav className="p-3 space-y-0.5 mt-1">
            {NAV.map(({ id, label, icon: Icon, key }) => (
              <button
                key={id}
                onClick={() => setPage(id)}
                aria-current={page === id ? 'page' : undefined}
                className={`w-full flex items-center gap-3 h-10 px-3 rounded-[10px] text-sm font-medium transition-colors group ${page === id ? 'bg-accent/15 text-ink' : 'text-ink-2 hover:text-ink hover:bg-surface-3'}`}
              >
                <Icon size={17} className={page === id ? 'text-accent-2' : 'text-ink-3 group-hover:text-ink-2'} />
                <span className="flex-1 text-left">{label}</span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity"><Kbd>⌃{key}</Kbd></span>
              </button>
            ))}
          </nav>

          <div className="mt-auto p-3 space-y-2">
            <div className={`card-2 p-3 space-y-2 transition-colors ${live ? 'border-live/30' : ''}`}>
              <div className="flex items-center gap-2 text-xs">
                <Circle size={9} className={live ? 'fill-live text-live pulse-dot' : status.starting ? 'fill-warn text-warn' : 'fill-ink-3/40 text-ink-3/40'} />
                <span className="font-semibold">{live ? 'Recording' : status.starting ? 'Starting…' : 'Not recording'}</span>
                {live && status.bufferedSeconds !== undefined && <span className="ml-auto tabular text-ink-3">{Math.min(status.bufferedSeconds, settings.capture.bufferSeconds)}s ready</span>}
              </div>
              {game && (
                <div className="flex items-center gap-2 text-xs text-ink-2 min-w-0">
                  <GameIcon src={game.icon ? `cf://file/${encodeURIComponent(game.icon.replace(/\\/g, '/'))}` : undefined} name={game.name} size={16} />
                  <span className="truncate">{game.name}</span>
                  {game.isGame && <span className="ml-auto text-[10px] uppercase tracking-wide text-live">game</span>}
                </div>
              )}
              {status.recordingBlocked && <div className="text-[11px] text-warn leading-snug">{status.recordingBlocked}</div>}
            </div>
            {live ? (
              <>
                <button className="btn-live w-full" onClick={() => void clipNow()}>
                  <Zap size={16} /> Clip now
                  {settings.capture.clipHotkey && <Kbd>{settings.capture.clipHotkey}</Kbd>}
                </button>
                <button className="btn w-full" onClick={() => void stop()}>Stop recording</button>
              </>
            ) : (
              <button className="btn-primary w-full" disabled={status.starting} onClick={() => void start()}>
                {status.starting ? 'Starting…' : 'Start recording'}
              </button>
            )}
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[1180px] mx-auto px-7 py-6 fade-in" key={page}>
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
