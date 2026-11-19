import { useEffect, useState } from 'react'
import { CheckCircle2, CloudUpload, ExternalLink, FolderOpen, HardDrive, Loader2, ShieldCheck } from 'lucide-react'
import type { Clip, CloudFolder, OwnCloudState } from '../../../shared/types'
import { useStore } from '../lib/store'
import { useToast } from './Toasts'
import { Badge, Progress, Section, Segmented, Toggle } from './ui'

const err = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Live state of the copier (queue, current copy, errors). */
export function useOwnCloud() {
  const [st, setSt] = useState<OwnCloudState | null>(null)
  useEffect(() => {
    void window.cf.ownCloud.state().then(setSt)
    const off = window.cf.on('own-cloud', (s: OwnCloudState) => setSt(s))
    return () => { off() }
  }, [])
  return st
}

const PROVIDER_ICON: Record<CloudFolder['provider'], string> = { google: 'Google Drive', onedrive: 'OneDrive', dropbox: 'Dropbox', icloud: 'iCloud', folder: 'Folder' }

/** Settings → Your cloud: pick a synced folder; Clutch copies clips into it. */
export function OwnCloudSettings() {
  const { settings } = useStore()
  const toast = useToast()
  const st = useOwnCloud()
  const [found, setFound] = useState<{ folders: CloudFolder[]; apps: Record<string, { name: string; url: string }> } | null>(null)
  useEffect(() => { void window.cf.ownCloud.detect().then(setFound) }, [])
  if (!settings) return null
  const oc = settings.ownCloud
  const set = (patch: Parameters<typeof window.cf.ownCloud.set>[0]) => window.cf.ownCloud.set(patch).catch((e) => toast.push({ kind: 'error', title: 'Not saved', body: err(e) }))
  const choose = async (f: CloudFolder) => { await set({ folder: f.path, provider: f.provider }) }
  const other = async () => {
    const p = await window.cf.ownCloud.pickFolder()
    if (p) await set({ folder: p, provider: 'folder' })
  }
  const missing = found ? Object.entries(found.apps).filter(([id]) => !found.folders.some((f) => f.provider === id)) : []

  return (
    <Section
      title="Your cloud"
      icon={<CloudUpload size={16} />}
      desc="Keep copies of your clips in your own Google Drive, OneDrive, Dropbox or iCloud. Clutch copies them into the folder your cloud app syncs, and that app uploads them to your account. No Clutch account, no keys, and nothing passes through Clutch's servers."
      right={<Badge tone="ok"><ShieldCheck size={11} /> Yours only</Badge>}
    >
      <div className="space-y-2" role="radiogroup" aria-label="Cloud folder">
        {found?.folders.map((f) => (
          <button key={f.path} role="radio" aria-checked={oc.folder === f.path} onClick={() => void choose(f)}
            className={`w-full text-left card-2 p-3 flex items-center gap-3 hover:bg-surface-3 ${oc.folder === f.path ? 'ring-1 ring-accent' : ''}`}>
            <HardDrive size={16} className="text-ink-3 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{f.label}</div>
              <div className="text-xs text-ink-3 truncate">{f.path}</div>
            </div>
            {oc.folder === f.path && <CheckCircle2 size={16} className="text-ok" />}
          </button>
        ))}
        {oc.folder && !found?.folders.some((f) => f.path === oc.folder) && (
          <div className="card-2 p-3 flex items-center gap-3 ring-1 ring-accent">
            <FolderOpen size={16} className="text-ink-3" />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">{PROVIDER_ICON[oc.provider || 'folder']}</div><div className="text-xs text-ink-3 truncate">{oc.folder}</div></div>
            <CheckCircle2 size={16} className="text-ok" />
          </div>
        )}
        {found && !found.folders.length && <p className="text-sm text-ink-3">No cloud app found on this PC. Install one below, sign in to it, then come back.</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button className="btn-sm" onClick={() => void other()}><FolderOpen size={12} /> Another folder (NAS, USB drive…)</button>
          {oc.folder && <button className="btn-sm" onClick={() => void window.cf.ownCloud.open()}><ExternalLink size={12} /> Open</button>}
          {missing.map(([id, a]) => <button key={id} className="btn-sm" onClick={() => void window.cf.system.openExternal(a.url)}>Get {a.name}</button>)}
        </div>
      </div>

      {oc.folder && (
        <div className="card-2 p-4 space-y-3">
          <Toggle checked={oc.enabled} onChange={(enabled) => void set({ enabled })} label="Copy clips automatically" hint="Copies run one at a time and pause while you record. Originals stay where they are, and Clutch never deletes anything in your cloud folder." />
          {oc.enabled && (
            <Segmented ariaLabel="Which clips" value={oc.mode} onChange={(mode) => void set({ mode })} options={[
              { value: 'favorites', label: 'Favorites', title: 'Clips you favorite' },
              { value: 'all', label: 'Every new clip', title: 'Every clip from now on (not full-length recordings)' },
              { value: 'manual', label: 'Only when I ask', title: 'Use "Save to my cloud" on a clip' }
            ]} />
          )}
          {st && (
            <div className="text-xs text-ink-3 space-y-1.5" aria-live="polite">
              <div>{st.savedCount} clip{st.savedCount === 1 ? '' : 's'} saved{st.queued ? ` · ${st.queued} waiting` : ''}</div>
              {st.current && <><div>Copying “{st.current.title}”…</div><Progress value={st.current.progress} tone="ok" /></>}
              {st.lastError && <div className="text-bad">Last copy failed: {st.lastError}</div>}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

/** Clip viewer → Share: save this clip to the user's own cloud folder. */
export function OwnCloudBlock({ clip }: { clip: Clip }) {
  const { settings, goTo } = useStore()
  const toast = useToast()
  const st = useOwnCloud()
  const [saved, setSaved] = useState<string | null>(null)
  useEffect(() => { void window.cf.ownCloud.savedFor(clip.id).then(setSaved) }, [clip.id, st?.savedCount])
  const copying = st?.current?.clipId === clip.id
  const folder = settings?.ownCloud.folder
  const save = async () => {
    if (!folder) { goTo('settings'); toast.push({ kind: 'info', title: 'Choose your cloud folder first', body: 'Settings → Your cloud' }); return }
    try { await window.cf.ownCloud.save([clip.id]) } catch (e) { toast.push({ kind: 'error', title: 'Not saved', body: err(e) }) }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="w-8 h-8 rounded-lg bg-ok/15 text-ok grid place-items-center"><CloudUpload size={16} /></span>
        <div className="min-w-0">
          <div className="font-semibold">My cloud</div>
          <div className="text-xs text-ink-3 truncate">{saved ? 'Saved to your cloud folder' : folder ? 'Copy to your own cloud folder' : 'Google Drive, OneDrive, Dropbox or any folder'}</div>
        </div>
      </div>
      {saved ? (
        <button className="btn-sm" onClick={() => void window.cf.ownCloud.open()}><CheckCircle2 size={12} className="text-ok" /> Saved · open folder</button>
      ) : (
        <>
          <button className="btn w-full" disabled={copying} onClick={() => void save()}>{copying ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />} {copying ? `Copying ${Math.round((st?.current?.progress ?? 0) * 100)}%` : 'Save to my cloud'}</button>
          {copying && <Progress value={st?.current?.progress ?? 0} tone="ok" />}
        </>
      )}
    </div>
  )
}
