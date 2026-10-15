import { useEffect, useState } from 'react'
import { FolderOpen, FolderPlus, Library as LibraryIcon, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import type { LibraryInfo } from '../../../shared/types'
import { fmtBytes, useStore } from '../lib/store'
import { Section } from './ui'
import { useToast } from './Toasts'

const err = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** The list of other libraries, kept live (scan progress arrives as events). */
export function useLibraries() {
  const [libs, setLibs] = useState<LibraryInfo[]>([])
  useEffect(() => {
    void window.cf.libraries.list().then(setLibs)
    const off = window.cf.on('libraries', (l: LibraryInfo[]) => setLibs(l))
    return () => { off() }
  }, [])
  return libs
}

/** Medal's clips folder, if Medal is installed and that folder isn't a library yet. */
export function useMedalOffer() {
  const libs = useLibraries()
  const [medal, setMedal] = useState<{ path: string; added: boolean } | null>(null)
  useEffect(() => { void window.cf.libraries.detectMedal().then(setMedal) }, [libs.length])
  return medal && !medal.added ? medal : null
}

/** Settings → Libraries: Clutch's own folder plus Medal and any other folders, read in place. */
export function Libraries() {
  const { settings } = useStore()
  const toast = useToast()
  const libs = useLibraries()
  const medal = useMedalOffer()
  const [own, setOwn] = useState<{ count: number; bytes: number } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  useEffect(() => { void window.cf.library.stats().then(setOwn) }, [libs])

  const add = async (kind: 'medal' | 'folder') => {
    setBusy(kind)
    try {
      const l = kind === 'medal' ? await window.cf.libraries.addMedal() : await window.cf.libraries.addFolder()
      if (l) toast.push({ kind: 'success', title: `Adding your ${l.name} clips`, body: 'They show up in Clips as they are found. Nothing is copied or moved.' })
    } catch (e) {
      toast.push({ kind: 'error', title: 'Could not add that folder', body: err(e) })
    } finally { setBusy('') }
  }

  return (
    <Section
      title="Libraries"
      icon={<LibraryIcon size={16} />}
      desc="Show clips from Medal, OBS, NVIDIA or any folder next to Clutch's own. They stay where they are: Clutch never copies, moves, shrinks or deletes them."
      right={<button className="btn" disabled={!!busy} onClick={() => void add('folder')}>{busy === 'folder' ? <Loader2 size={15} className="animate-spin" /> : <FolderPlus size={15} />} Add folder</button>}
    >
      {medal && (
        <div className="card-2 p-3.5 flex items-center gap-3 text-sm">
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-accent/15 text-accent shrink-0"><LibraryIcon size={17} /></span>
          <div className="flex-1 min-w-0">
            <div className="font-medium">Medal is installed on this PC</div>
            <div className="text-xs text-ink-3 truncate">Add your Medal clips ({medal.path}) to Clutch. Medal keeps working as before.</div>
          </div>
          <button className="btn-primary h-9" disabled={!!busy} onClick={() => void add('medal')}>{busy === 'medal' ? <Loader2 size={15} className="animate-spin" /> : null} Add Medal clips</button>
        </div>
      )}

      <ul className="space-y-2">
        <li className="card-2 p-3.5 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-white/[0.06] shrink-0"><img src="./icon.png" alt="" className="w-5 h-5" /></span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Clutch <span className="text-xs text-ink-3 font-normal">· recorded by Clutch</span></div>
            <div className="text-xs text-ink-3 truncate">{settings?.capture.outputDir}{own ? ` · ${own.count} clip${own.count === 1 ? '' : 's'} · ${fmtBytes(own.bytes)}` : ''}</div>
          </div>
          <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => void window.cf.library.openFolder()}><FolderOpen size={14} /> Open</button>
        </li>
        {libs.map((l) => (
          <li key={l.id} className="card-2 p-3.5 space-y-2.5">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-lg grid place-items-center bg-white/[0.06] text-ink-2 shrink-0"><FolderOpen size={17} /></span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{l.name}</div>
                <div className={`text-xs truncate ${l.missing ? 'text-warn' : 'text-ink-3'}`}>
                  {l.missing ? `Can't open ${l.path} right now (drive unplugged or folder moved). Its clips come back when it's reachable.` : `${l.path} · ${l.count} video${l.count === 1 ? '' : 's'} · ${fmtBytes(l.bytes)}`}
                </div>
              </div>
              {confirmRemove === l.id ? (
                <>
                  <span className="text-xs text-ink-2 hidden xl:inline">Remove from Clutch? The files stay.</span>
                  <button className="btn-danger h-8 px-3 text-xs" onClick={() => { void window.cf.libraries.remove(l.id); setConfirmRemove(null) }}>Remove</button>
                  <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => setConfirmRemove(null)}>Keep</button>
                </>
              ) : (
                <>
                  <button className="btn-ghost h-8 w-8 px-0" title="Look for new videos" aria-label={`Rescan ${l.name}`} disabled={!!l.scanning || l.missing} onClick={() => void window.cf.libraries.rescan(l.id)}><RefreshCw size={14} className={l.scanning ? 'animate-spin' : ''} /></button>
                  <button className="btn-ghost h-8 w-8 px-0" title="Open folder" aria-label={`Open ${l.name} folder`} disabled={l.missing} onClick={() => void window.cf.libraries.open(l.id)}><FolderOpen size={14} /></button>
                  <button className="btn-ghost h-8 w-8 px-0 hover:text-bad" title="Remove from Clutch (files stay)" aria-label={`Remove ${l.name} from Clutch`} onClick={() => setConfirmRemove(l.id)}><Trash2 size={14} /></button>
                </>
              )}
            </div>
            {l.scanning && l.scanning.total > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-ink-3"><span>Adding videos (thumbnails and lengths)…</span><span className="tabular">{l.scanning.done} of {l.scanning.total}</span></div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full bg-accent rounded-full transition-[width] duration-300" style={{ width: `${(l.scanning.done / l.scanning.total) * 100}%` }} /></div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-3">New videos are picked up when Clutch starts and every 30 minutes. A first-level folder is used as the game (Medal, OBS and NVIDIA sort clips by game). Edits and trims of these videos are saved into Clutch's own folder.</p>
    </Section>
  )
}
