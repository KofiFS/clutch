import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckSquare, Eye, Film, Flame, MessageSquare, Video, FolderOpen, Heart, Keyboard, Mic, MousePointerClick, Search, Tag, Trash2, UploadCloud, X, Undo2 } from 'lucide-react'
import type { Clip, TriggerSource } from '../../../shared/types'
import { dayLabel, fileUrl, fmtDuration, timeAgo, useStore } from '../lib/store'
import type { GameSummary } from '../../../shared/types'
import { Empty, GameIcon, Kbd, useConfirm } from '../components/ui'
import { useToast } from '../components/Toasts'

const TRIGGER_ICON: Record<TriggerSource, typeof Eye> = { hotkey: Keyboard, vision: Eye, voice: Mic, hype: Flame, manual: MousePointerClick, long: Video }
const TRIGGER_LABEL: Record<TriggerSource, string> = { hotkey: 'Hotkey', vision: 'AI', voice: 'Voice', hype: 'Hype', manual: 'Manual', long: 'Long' }

export default function Library() {
  const { libraryVersion, settings, openClip, viewerClipId, libraryPreset, setLibraryPreset } = useStore()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const [clips, setClips] = useState<Clip[]>([])
  const [games, setGames] = useState<GameSummary[]>([])
  const [text, setText] = useState('')
  const [game, setGame] = useState('')
  const [trigger, setTrigger] = useState<TriggerSource | 'all'>('all')
  const [fav, setFav] = useState(false)
  const [sort, setSort] = useState<'newest' | 'oldest' | 'longest' | 'largest'>('newest')
  const [view, setView] = useState<'clips' | 'trash'>('clips')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [tagDraft, setTagDraft] = useState<string | null>(null)
  const lastClicked = useRef<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Filters handed over by search or the tray ("show Valorant clips", "open trash").
  useEffect(() => {
    if (!libraryPreset) return
    if (libraryPreset.game !== undefined) setGame(libraryPreset.game)
    if (libraryPreset.text !== undefined) setText(libraryPreset.text)
    if (libraryPreset.view) setView(libraryPreset.view)
    setLibraryPreset(null)
  }, [libraryPreset, setLibraryPreset])

  const reload = useCallback(() => {
    void window.cf.library.query({ text, game: game || undefined, trigger, favoritesOnly: fav, sort, trashed: view === 'trash' }).then(setClips)
    void window.cf.library.games().then(setGames)
  }, [text, game, trigger, fav, sort, view])
  useEffect(reload, [reload, libraryVersion])
  useEffect(() => setSelected(new Set()), [view, game, trigger, fav, text])

  // Keyboard: / focus search, Ctrl+A select all, Delete trash selection, Esc clear selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewerClipId) return
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA'
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus() }
      if (e.key === 'Escape') { setSelected(new Set()); setTagDraft(null); searchRef.current?.blur() }
      if (e.ctrlKey && e.key.toLowerCase() === 'a' && !typing) { e.preventDefault(); setSelected(new Set(clips.map((c) => c.id))) }
      if (e.key === 'Delete' && selected.size && !typing) void trashSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const grouped = useMemo(() => {
    const map = new Map<string, Clip[]>()
    for (const c of clips) {
      const key = view === 'trash' ? 'Trash' : dayLabel(c.createdAt)
      map.set(key, [...(map.get(key) ?? []), c])
    }
    return [...map.entries()]
  }, [clips, view])

  const toggleSelect = (c: Clip, e: React.MouseEvent) => {
    const next = new Set(selected)
    if (e.shiftKey && lastClicked.current) {
      const ids = clips.map((x) => x.id)
      const a = ids.indexOf(lastClicked.current), b = ids.indexOf(c.id)
      for (const id of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(id)
    } else if (next.has(c.id)) next.delete(c.id)
    else next.add(c.id)
    lastClicked.current = c.id
    setSelected(next)
  }

  const trashSelected = async () => {
    const ids = [...selected]
    if (!ids.length) return
    if (!settings?.app.useTrash && !(await confirm({ title: `Delete ${ids.length} clip${ids.length > 1 ? 's' : ''}?`, body: 'The files are removed from disk permanently.', confirmLabel: 'Delete', danger: true }))) return
    const toTrash = await window.cf.library.trash(ids)
    setSelected(new Set())
    toast.push({
      kind: 'info',
      title: toTrash ? `Moved ${ids.length} clip${ids.length > 1 ? 's' : ''} to trash` : `Deleted ${ids.length} clip${ids.length > 1 ? 's' : ''}`,
      action: toTrash ? { label: 'Undo', onClick: () => void window.cf.library.restore(ids) } : undefined
    })
  }
  const bulkFav = (favorite: boolean) => void window.cf.library.bulk([...selected], { favorite })
  const bulkTag = () => { if (tagDraft?.trim()) void window.cf.library.bulk([...selected], { addTags: tagDraft.split(',').map((t) => t.trim()).filter(Boolean) }); setTagDraft(null) }
  const bulkDiscord = async () => {
    const ids = [...selected]
    setSelected(new Set())
    toast.push({ kind: 'info', title: `Posting ${ids.length} clip${ids.length > 1 ? 's' : ''} to Discord…` })
    let ok = 0
    for (const id of ids) {
      try { await window.cf.discord.post(id); ok++ } catch (e) { toast.push({ kind: 'error', title: 'Discord post failed', body: String((e as Error)?.message ?? e) }); break }
    }
    if (ok) toast.push({ kind: 'success', title: `Posted ${ok} clip${ok > 1 ? 's' : ''} to Discord` })
  }
  const bulkUpload = () => { for (const id of selected) void window.cf.upload.enqueue(id, 'youtube'); toast.push({ kind: 'success', title: `Queued ${selected.size} upload${selected.size > 1 ? 's' : ''}` }); setSelected(new Set()) }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clips</h1>
          <p className="text-ink-3 text-sm mt-1">{clips.length} {view === 'trash' ? 'in trash' : 'clips'}{game ? ` in ${game}` : ''} · <button className="hover:text-ink underline-offset-2 hover:underline" onClick={() => void window.cf.library.openFolder()}>{settings?.capture.outputDir}</button></p>
        </div>
        <div className="flex items-center gap-2">
          <button className={`btn ${view === 'trash' ? 'border-accent' : ''}`} onClick={() => setView(view === 'trash' ? 'clips' : 'trash')}><Trash2 size={15} /> {view === 'trash' ? 'Back to clips' : 'Trash'}</button>
          <button className="btn" onClick={() => void window.cf.library.openFolder()}><FolderOpen size={15} /> Open folder</button>
        </div>
      </header>

      {/* Game strip */}
      {view === 'clips' && games.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mb-1">
          <button onClick={() => setGame('')} className={`chip h-8 px-3 shrink-0 transition-colors ${!game ? 'border-accent text-ink bg-accent/10' : 'hover:border-line-strong'}`}>All games</button>
          {games.map((g) => (
            <button key={g.name} onClick={() => setGame(game === g.name ? '' : g.name)} className={`chip h-8 px-2.5 shrink-0 gap-2 transition-colors ${game === g.name ? 'border-accent text-ink bg-accent/10' : 'hover:border-line-strong'}`}>
              <GameIcon src={g.icon ? fileUrl(g.icon) : undefined} name={g.name} size={16} />
              {g.name}
              <span className="text-ink-3 tabular">{g.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-64">
          <Search size={15} className="absolute left-3 top-3 text-ink-3" />
          <input ref={searchRef} className="input pl-9 pr-10" placeholder="Search titles, games, events, tags" value={text} onChange={(e) => setText(e.target.value)} />
          <span className="absolute right-2.5 top-2"><Kbd>/</Kbd></span>
        </div>
        <div className="inline-flex p-1 rounded-[10px] bg-surface-2 border border-line gap-0.5">
          {(['all', 'hotkey', 'hype', 'voice', 'vision', 'long'] as const).map((t) => (
            <button key={t} onClick={() => setTrigger(t)} className={`h-8 px-3 rounded-md text-sm font-medium transition-colors ${trigger === t ? 'bg-surface-4 text-ink' : 'text-ink-3 hover:text-ink-2'}`}>{t === 'all' ? 'All' : TRIGGER_LABEL[t]}</button>
          ))}
        </div>
        <button className={`btn ${fav ? 'border-bad/50 text-ink' : ''}`} onClick={() => setFav(!fav)}><Heart size={15} className={fav ? 'fill-bad text-bad' : ''} /> Favorites</button>
        <select className="input w-36" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="longest">Longest</option>
          <option value="largest">Largest file</option>
        </select>
      </div>

      {clips.length === 0 && (
        view === 'trash'
          ? <Empty icon={<Trash2 size={22} />} title="Trash is empty" hint="Deleted clips stay here for 30 days." />
          : <Empty icon={<Film size={22} />} title={text || game || fav || trigger !== 'all' ? 'No clips match' : 'No clips yet'} hint={text || game || fav || trigger !== 'all' ? 'Try clearing a filter.' : `Start recording and press ${settings?.capture.clipHotkey || 'Clip now'} when something happens. Or turn on a trigger under “What to clip”.`} />
      )}

      {grouped.map(([day, list]) => (
        <section key={day}>
          <div className="flex items-center gap-3 mb-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">{day}</h3>
            <span className="flex-1 h-px bg-line" />
            <span className="text-xs text-ink-3 tabular">{list.length}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(236px,1fr))] gap-3">
            {list.map((c) => {
              const Icon = TRIGGER_ICON[c.trigger]
              const isSel = selected.has(c.id)
              return (
                <div key={c.id} className={`card overflow-hidden group relative transition-all hover:border-line-strong hover:-translate-y-px ${isSel ? 'border-accent shadow-[var(--shadow-glow)]' : ''}`}>
                  <button className="block w-full aspect-video bg-surface-3 relative" onClick={(e) => (selected.size || e.ctrlKey || e.shiftKey ? toggleSelect(c, e) : openClip(c.id))} aria-label={`Open ${c.title}`}>
                    <HoverPreview clip={c} />
                    <span className="absolute bottom-1.5 right-1.5 chip bg-black/70 border-0 text-white tabular">{fmtDuration(c.durationSec)}</span>
                    <span className="absolute top-1.5 right-1.5 chip bg-black/70 border-0 text-white"><Icon size={11} /> {TRIGGER_LABEL[c.trigger]}</span>
                    {c.uploads.some((u) => u.status === 'done') && <span className="absolute bottom-1.5 left-1.5 chip bg-black/70 border-0 text-white"><UploadCloud size={11} /> Uploaded</span>}
                  </button>
                  <label className={`absolute top-2 left-2 w-7 h-7 rounded-md grid place-items-center bg-black/60 cursor-pointer transition-opacity ${isSel || selected.size ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} onClick={(e) => { e.preventDefault(); toggleSelect(c, e) }}>
                    <input type="checkbox" className="check" checked={isSel} readOnly aria-label="Select clip" />
                  </label>
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <GameIcon src={c.gameIcon ? fileUrl(c.gameIcon) : undefined} name={c.game} size={18} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium truncate" title={c.title}>{c.title}</div>
                        <div className="text-xs text-ink-3 truncate">{c.game} · {timeAgo(c.createdAt)}{c.event ? ` · ${c.event}` : ''}</div>
                      </div>
                      {view === 'clips' && (
                        <button onClick={() => void window.cf.library.update(c.id, { favorite: !c.favorite })} className={`w-7 h-7 -mr-1 -mt-1 rounded-md grid place-items-center hover:bg-surface-3 ${c.favorite ? 'text-bad' : 'text-ink-3 hover:text-bad'}`} aria-label={c.favorite ? 'Unfavorite' : 'Favorite'}>
                          <Heart size={15} className={c.favorite ? 'fill-bad' : ''} />
                        </button>
                      )}
                    </div>
                    {c.tags.length > 0 && <div className="flex flex-wrap gap-1 mt-2">{c.tags.slice(0, 4).map((t) => <span key={t} className="chip text-[11px] py-0">{t}</span>)}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pop-in">
        <div className="card-2 hud shadow-[var(--shadow-pop)] px-3 py-2 flex items-center gap-2 rounded-full">
          <span className="text-sm font-medium px-2 flex items-center gap-2"><CheckSquare size={15} className="text-accent-2" /> {selected.size} selected</span>
          <span className="w-px h-6 bg-line" />
          {view === 'clips' ? (
            <>
              <button className="btn-sm" onClick={() => bulkFav(true)}><Heart size={13} /> Favorite</button>
              <button className="btn-sm" onClick={() => bulkFav(false)}>Unfavorite</button>
              {tagDraft === null ? (
                <button className="btn-sm" onClick={() => setTagDraft('')}><Tag size={13} /> Tag</button>
              ) : (
                <input autoFocus className="input h-8 w-44 text-xs" placeholder="funny, clutch…" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') bulkTag(); if (e.key === 'Escape') setTagDraft(null) }} onBlur={bulkTag} />
              )}
              <button className="btn-sm" onClick={() => void bulkDiscord()} disabled={!settings?.discord.webhookUrl} title={settings?.discord.webhookUrl ? '' : 'Add a Discord webhook in Settings first'}><MessageSquare size={13} /> Discord</button>
              <button className="btn-sm" onClick={bulkUpload} disabled={!settings?.upload.youtube.connected} title={settings?.upload.youtube.connected ? '' : 'Connect YouTube first'}><UploadCloud size={13} /> Upload</button>
              <button className="btn-sm hover:text-bad" onClick={() => void trashSelected()}><Trash2 size={13} /> Delete <Kbd>Del</Kbd></button>
            </>
          ) : (
            <>
              <button className="btn-sm" onClick={() => { void window.cf.library.restore([...selected]); setSelected(new Set()) }}><Undo2 size={13} /> Restore</button>
              <button className="btn-sm hover:text-bad" onClick={async () => { if (await confirm({ title: 'Delete permanently?', body: 'This cannot be undone.', confirmLabel: 'Delete forever', danger: true })) { void window.cf.library.remove([...selected]); setSelected(new Set()) } }}><Trash2 size={13} /> Delete forever</button>
            </>
          )}
          <button className="btn-ghost h-8 w-8 px-0" onClick={() => setSelected(new Set())} aria-label="Clear selection"><X size={14} /></button>
        </div>
        </div>
      )}
      {confirmDialog}
    </div>
  )
}

function HoverPreview({ clip }: { clip: Clip }) {
  const [hover, setHover] = useState(false)
  return (
    <div className="w-full h-full" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {hover ? (
        <video src={fileUrl(clip.file)} muted autoPlay loop className="w-full h-full object-cover" />
      ) : (
        <img src={fileUrl(clip.thumbnail)} alt="" className="w-full h-full object-cover" loading="lazy" />
      )}
    </div>
  )
}
