import { useState } from 'react'
import { Circle, Film, LayoutDashboard, Settings as SettingsIcon, Sparkles, UploadCloud } from 'lucide-react'
import { StoreProvider, useStore } from './lib/store'
import Dashboard from './pages/Dashboard'
import Library from './pages/Library'
import Rules from './pages/Rules'
import Uploads from './pages/Uploads'
import Settings from './pages/Settings'

type Page = 'dashboard' | 'library' | 'rules' | 'uploads' | 'settings'

const NAV: { id: Page; label: string; icon: typeof Film }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'library', label: 'Clips', icon: Film },
  { id: 'rules', label: 'What to clip', icon: Sparkles },
  { id: 'uploads', label: 'Uploads', icon: UploadCloud },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

function Shell() {
  const [page, setPage] = useState<Page>('dashboard')
  const { status, start, stop, clipNow, settings } = useStore()
  return (
    <div className="h-full flex">
      <aside className="w-56 shrink-0 border-r border-line bg-panel flex flex-col">
        <div className="px-5 py-5 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent-2 grid place-items-center font-black text-white">C</div>
          <div>
            <div className="font-semibold leading-tight">ClipForge</div>
            <div className="text-[11px] text-muted leading-tight">smart game clips</div>
          </div>
        </div>
        <nav className="px-3 space-y-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${page === id ? 'bg-accent/15 text-ink' : 'text-muted hover:text-ink hover:bg-panel-2'}`}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto p-3 space-y-2">
          <div className="card p-3 text-xs space-y-2">
            <div className="flex items-center gap-2">
              <Circle size={10} className={status.running ? 'fill-ok text-ok' : 'fill-muted/40 text-muted/40'} />
              <span className="font-medium">{status.running ? 'Recording buffer' : 'Idle'}</span>
            </div>
            {status.running && <div className="text-muted truncate">{status.game ?? 'Desktop'} · {status.fps} fps · {status.encoder}</div>}
            {status.recordingBlocked && <div className="text-warn">{status.recordingBlocked}</div>}
          </div>
          {status.running ? (
            <>
              <button className="btn-primary w-full justify-center" onClick={() => void clipNow()}>Clip now ({settings?.capture.clipHotkey || 'hotkey'})</button>
              <button className="btn w-full justify-center" onClick={() => void stop()}>Stop</button>
            </>
          ) : (
            <button className="btn-primary w-full justify-center" onClick={() => void start()}>Start recording</button>
          )}
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6">
          {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
          {page === 'library' && <Library />}
          {page === 'rules' && <Rules />}
          {page === 'uploads' && <Uploads />}
          {page === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
