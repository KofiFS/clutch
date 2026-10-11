import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CornerDownLeft, Film, Gamepad2, Search, Settings as SettingsIcon, Sparkles, Zap } from 'lucide-react'
import type { Clip, GameSummary } from '../../../shared/types'
import { fileUrl, fmtDuration, useStore, type Page } from '../lib/store'
import { GameIcon, Kbd } from './ui'

interface Item {
  id: string
  group: 'Actions' | 'Pages' | 'Settings' | 'Clips' | 'Games'
  label: string
  sub?: string
  keywords?: string
  icon?: React.ReactNode
  run: () => void | Promise<void>
}

/** Settings and controls people look for, with the page they live on and the text to scroll to. */
const SETTINGS: { label: string; page: Page; find: string; keywords?: string }[] = [
  { label: 'Recording area', page: 'settings', find: 'Recording area', keywords: 'region window crop part of screen monitor select area obs capture' },
  { label: 'Where clips are saved', page: 'settings', find: 'Storage', keywords: 'folder location path save directory disk space storage' },
  { label: 'Quality presets', page: 'settings', find: 'Quality', keywords: 'bitrate cq encoder resolution 4k best small files' },
  { label: 'Frame rate (fps)', page: 'settings', find: 'Frame rate', keywords: 'fps 60 120 144 smooth' },
  { label: 'Resolution', page: 'settings', find: 'Resolution', keywords: 'native 75% 50% size' },
  { label: 'Buffer length (keep the last…)', page: 'settings', find: 'Keep the last', keywords: 'replay buffer seconds how far back' },
  { label: 'Clip hotkey', page: 'settings', find: 'Clip hotkey', keywords: 'key shortcut f8 f9 keybind' },
  { label: 'Change clip length in game', page: 'settings', find: 'Change clip length in game', keywords: 'length duration seconds alt pageup pagedown extra hotkey' },
  { label: 'Long recording & bookmarks', page: 'settings', find: 'Long recording & bookmarks', keywords: 'session record full alt f9 bookmark marker' },
  { label: 'Start recording when a game opens', page: 'settings', find: 'Start recording when a game opens', keywords: 'auto start detect game' },
  { label: 'Audio sources', page: 'settings', find: 'Audio sources', keywords: 'microphone mic input volume track separate discord desktop audio sound' },
  { label: 'Appearance', page: 'settings', find: 'Appearance', keywords: 'theme glass lite effects transparent acrylic look' },
  { label: 'On-screen “Clipped!” popup', page: 'settings', find: 'On-screen “Clipped!” popup', keywords: 'overlay toast notification in game' },
  { label: 'Start with Windows', page: 'settings', find: 'Start with Windows', keywords: 'startup login boot tray' },
  { label: 'Discord', page: 'settings', find: 'Discord', keywords: 'webhook channel post share server' },
  { label: 'Clip of the day', page: 'settings', find: 'Post my clip of the day', keywords: 'daily best digest discord' },
  { label: 'AI / API key', page: 'settings', find: 'AI', keywords: 'anthropic claude key model auto title' },
  { label: 'Account & Clutch Pro', page: 'settings', find: 'Account', keywords: 'login sign in discord google cloud subscription pro plan billing' },
  { label: 'YouTube account', page: 'settings', find: 'Accounts', keywords: 'youtube connect google upload channel' },
  { label: 'Health check', page: 'settings', find: 'Health check', keywords: 'problems diagnose not working fix ffmpeg' },
  { label: 'Hype moments', page: 'rules', find: 'Hype moments', keywords: 'shout laugh loud spike trigger' },
  { label: 'When people talk', page: 'rules', find: 'Only when people talk', keywords: 'voice chat talking trigger' },
  { label: 'Watch the screen (AI)', page: 'rules', find: 'Watch the screen for moments', keywords: 'kills goals ai vision rules' },
  { label: 'Which games to clip', page: 'rules', find: 'Which games', keywords: 'block allow list never only' },
  { label: 'Per-game profiles', page: 'rules', find: 'Per-game profiles', keywords: 'profile per game fps quality' },
  { label: 'Auto-upload schedule', page: 'uploads', find: 'Auto-upload schedule', keywords: 'youtube schedule time daily upload' }
]

const PAGES: { page: Page; label: string; keywords: string }[] = [
  { page: 'dashboard', label: 'Home', keywords: 'dashboard start' },
  { page: 'library', label: 'Clips', keywords: 'library videos recordings' },
  { page: 'rules', label: 'What to clip', keywords: 'triggers rules' },
  { page: 'uploads', label: 'Uploads', keywords: 'youtube queue history' },
  { page: 'settings', label: 'Settings', keywords: 'options preferences' }
]

/** Simple ranked match: prefix > word start > substring > all words somewhere. */
function score(q: string, item: Item): number {
  if (!q) return 1
  const l = item.label.toLowerCase()
  const hay = `${l} ${(item.sub ?? '').toLowerCase()} ${(item.keywords ?? '').toLowerCase()}`
  if (l.startsWith(q)) return 100
  if (l.split(/[\s(/&·-]+/).some((w) => w.startsWith(q))) return 80
  if (l.includes(q)) return 60
  if (hay.includes(q)) return 40
  const words = q.split(/\s+/).filter(Boolean)
  if (words.length > 1 && words.every((w) => hay.includes(w))) return 30
  return 0
}

/** Scroll to a setting on the current page and briefly highlight it. */
export function revealText(text: string) {
  const want = text.toLowerCase()
  const candidates = [...document.querySelectorAll('main h2, main .label, main label span.text-sm, main .text-sm.font-semibold')]
  const el = candidates.find((n) => (n.textContent ?? '').trim().toLowerCase() === want) ?? candidates.find((n) => (n.textContent ?? '').trim().toLowerCase().startsWith(want))
  if (!el) return false
  const box = el.closest('.card-2, section, label, div.space-y-3') ?? el
  box.scrollIntoView({ block: 'center', behavior: 'smooth' })
  box.classList.remove('search-flash')
  void (box as HTMLElement).offsetWidth
  box.classList.add('search-flash')
  setTimeout(() => box.classList.remove('search-flash'), 1800)
  return true
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, save, status, setPage, openClip, start, stop, clipNow, setLibraryPreset } = useStore()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [clips, setClips] = useState<Clip[]>([])
  const [games, setGames] = useState<GameSummary[]>([])
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setSel(0)
    setTimeout(() => input.current?.focus(), 10)
    void window.cf.library.games().then(setGames)
  }, [open])
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => { void window.cf.library.query({ text: q.trim() || undefined, sort: 'newest' }).then((c) => setClips(c.slice(0, q.trim() ? 8 : 4))) }, 80)
    return () => clearTimeout(t)
  }, [q, open])

  const goSetting = (page: Page, find: string) => {
    setPage(page)
    let tries = 0
    const attempt = () => { if (!revealText(find) && ++tries < 10) setTimeout(attempt, 120) }
    setTimeout(attempt, 150)
  }

  const items = useMemo<Item[]>(() => {
    if (!settings) return []
    const s = settings
    const toggle = (label: string, on: boolean, apply: (v: boolean) => void, keywords: string): Item => ({ id: `t-${label}`, group: 'Actions', label: `${on ? 'Turn off' : 'Turn on'} ${label}`, keywords, icon: <Sparkles size={16} />, run: () => apply(!on) })
    const actions: Item[] = [
      status.running
        ? { id: 'a-stop', group: 'Actions', label: 'Stop recording', keywords: 'buffer off', icon: <Zap size={16} />, run: () => stop() }
        : { id: 'a-start', group: 'Actions', label: 'Start recording', keywords: 'buffer on record', icon: <Zap size={16} />, run: () => start() },
      { id: 'a-clip', group: 'Actions', label: 'Clip now', sub: s.capture.clipHotkey, keywords: 'save clip capture moment', icon: <Zap size={16} />, run: () => clipNow() },
      { id: 'a-long', group: 'Actions', label: status.longRecording ? 'Stop long recording' : 'Start long recording', sub: s.capture.longRecordHotkey, keywords: 'session record full', icon: <Zap size={16} />, run: () => { void window.cf.buffer.toggleLong() } },
      { id: 'a-area', group: 'Actions', label: 'Select recording area on screen', keywords: 'region crop drag part of screen', icon: <Zap size={16} />, run: async () => { const r = await window.cf.capture.pickRegion(s.capture.monitorIndex); if (r) void save({ capture: { ...s.capture, area: { kind: 'region', ...r, label: 'Custom area' } } }) } },
      { id: 'a-folder', group: 'Actions', label: 'Open clips folder', keywords: 'explorer files location', icon: <Film size={16} />, run: () => { void window.cf.library.openFolder() } },
      { id: 'a-trash', group: 'Actions', label: 'Open trash', keywords: 'deleted restore', icon: <Film size={16} />, run: () => { setLibraryPreset({ view: 'trash' }); setPage('library') } },
      toggle('hype moments', s.hype.enabled, (v) => void save({ hype: { ...s.hype, enabled: v } }), 'shout laugh trigger'),
      toggle('“when people talk”', s.voice.enabled, (v) => void save({ voice: { ...s.voice, enabled: v } }), 'voice trigger'),
      toggle('AI screen watching', s.vision.enabled, (v) => void save({ vision: { ...s.vision, enabled: v } }), 'vision ai trigger'),
      toggle('Lite effects', s.app.effects === 'lite', (v) => void save({ app: { ...s.app, effects: v ? 'lite' : 'full' } }), 'performance glass blur')
    ]
    const pages: Item[] = PAGES.map((p) => ({ id: `p-${p.page}`, group: 'Pages', label: p.label, keywords: p.keywords, icon: <ArrowRight size={16} />, run: () => setPage(p.page) }))
    const setts: Item[] = SETTINGS.map((x) => ({ id: `s-${x.label}`, group: 'Settings', label: x.label, sub: PAGES.find((p) => p.page === x.page)?.label, keywords: x.keywords, icon: <SettingsIcon size={16} />, run: () => goSetting(x.page, x.find) }))
    const gameItems: Item[] = games.filter((g) => g.name !== 'Desktop').map((g) => ({
      id: `g-${g.name}`, group: 'Games', label: g.name, sub: `${g.count} clip${g.count > 1 ? 's' : ''}`, keywords: g.process,
      icon: <GameIcon src={g.icon ? fileUrl(g.icon) : undefined} name={g.name} size={18} />,
      run: () => { setLibraryPreset({ game: g.name }); setPage('library') }
    }))
    return [...actions, ...pages, ...setts, ...gameItems]
  }, [settings, status.running, status.longRecording, games]) // eslint-disable-line react-hooks/exhaustive-deps

  const query = q.trim().toLowerCase()
  const ranked = items
    .map((it) => ({ it, s: score(query, it) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.it)
    .slice(0, query ? 14 : 9)
  const clipItems: Item[] = clips.map((c) => ({ id: `c-${c.id}`, group: 'Clips', label: c.title, sub: `${c.game} · ${fmtDuration(c.durationSec)}`, icon: <img src={fileUrl(c.thumbnail)} alt="" className="w-9 h-[22px] rounded object-cover" />, run: () => openClip(c.id) }))
  const results = query ? [...ranked.filter((x) => x.group !== 'Games'), ...ranked.filter((x) => x.group === 'Games'), ...clipItems] : [...ranked, ...clipItems]
  const groups = ['Actions', 'Pages', 'Settings', 'Games', 'Clips'] as const
  const ordered = groups.flatMap((g) => results.filter((r) => r.group === g))

  useEffect(() => { setSel(0) }, [q])
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!open) return null
  const choose = (it?: Item) => { if (!it) return; onClose(); void it.run() }

  let idx = -1
  return (
    <div className="fixed inset-0 z-[150] bg-[rgba(2,6,16,0.45)] backdrop-blur-sm flex items-start justify-center pt-[12vh] px-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-label="Search" className="w-full max-w-[640px] rounded-[22px] overflow-hidden border border-white/15 pop-in" style={{ background: 'rgba(8,14,28,0.94)', boxShadow: 'inset 0 1px 0.5px rgba(255,255,255,0.3), 0 40px 90px -20px rgba(0,0,0,0.95), 0 0 40px -16px rgba(79,227,255,0.6)' }}>
        <div className="flex items-center gap-3 px-5 h-14 border-b border-white/10">
          <Search size={18} className="text-accent shrink-0" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(ordered.length - 1, v + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(0, v - 1)) }
              if (e.key === 'Enter') { e.preventDefault(); choose(ordered[sel]) }
              if (e.key === 'Escape') onClose()
            }}
            placeholder="Search settings, clips, games, actions…"
            className="flex-1 bg-transparent text-[15px] focus:outline-none focus-visible:outline-none placeholder:text-ink-3"
            aria-label="Search"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={list} className="max-h-[52vh] overflow-y-auto p-2">
          {ordered.length === 0 && <div className="py-10 text-center text-sm text-ink-3">Nothing matches “{q}”.</div>}
          {groups.map((g) => {
            const rows = ordered.filter((r) => r.group === g)
            if (!rows.length) return null
            return (
              <div key={g} className="mb-1">
                <div className="px-3 pt-2 pb-1 font-hud text-[9px] uppercase tracking-[0.18em] text-ink-3">{g}</div>
                {rows.map((r) => {
                  idx++
                  const i = idx
                  const active = i === sel
                  return (
                    <button
                      key={r.id}
                      data-idx={i}
                      onMouseMove={() => setSel(i)}
                      onClick={() => choose(r)}
                      className={`w-full flex items-center gap-3 h-11 px-3 rounded-xl text-left transition-colors ${active ? 'bg-white/10 text-ink' : 'text-ink-2'}`}
                    >
                      <span className={`w-6 grid place-items-center shrink-0 ${active ? 'text-accent' : 'text-ink-3'}`}>{r.icon ?? <Gamepad2 size={16} />}</span>
                      <span className="flex-1 min-w-0 truncate text-sm">{r.label}</span>
                      {r.sub && <span className="text-xs text-ink-3 truncate max-w-[40%]">{r.sub}</span>}
                      {active && <CornerDownLeft size={14} className="text-ink-3 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-4 px-5 h-10 border-t border-white/10 text-[11px] text-ink-3">
          <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span className="flex items-center gap-1.5"><Kbd>Enter</Kbd> open</span>
          <span className="ml-auto flex items-center gap-1.5"><Kbd>Ctrl</Kbd><Kbd>K</Kbd> anywhere</span>
        </div>
      </div>
    </div>
  )
}
