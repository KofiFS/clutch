import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ClipboardPaste, FileUp, ImagePlus, Loader2, Sparkles, TriangleAlert, Wand2, X } from 'lucide-react'
import type { ImportChange, ImportResult } from '../../../shared/types'
import { useStore } from '../lib/store'
import { useToast } from './Toasts'
import { Section } from './ui'

type Shot = { name: string; url: string; data: ArrayBuffer }

/**
 * "Coming from Medal, OBS or NVIDIA?" Drop, paste or pick screenshots of the other app's settings.
 * Windows reads the text offline; the user reviews every change before it is applied.
 */
export function ImportSettings() {
  const { signIn, account, settings } = useStore()
  const toast = useToast()
  const [shots, setShots] = useState<Shot[]>([])
  const [obs, setObs] = useState(false)
  const [busy, setBusy] = useState<null | 'text' | 'smart' | 'obs' | 'apply'>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [changes, setChanges] = useState<ImportChange[]>([])
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const zone = useRef<HTMLDivElement>(null)

  useEffect(() => { void window.cf.importer.hasObs().then(setObs) }, [])
  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), []) // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/')).slice(0, 4 - shots.length)
    if (!imgs.length) return
    const next = await Promise.all(imgs.map(async (f) => ({ name: f.name || 'Pasted screenshot', url: URL.createObjectURL(f), data: await f.arrayBuffer() })))
    const all = [...shots, ...next].slice(0, 4)
    setShots(all)
    void read('text', all)
  }

  // Ctrl+V anywhere on the Settings page adds a screenshot from the clipboard (Win+Shift+S, then paste).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      zone.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      void add(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const show = (r: ImportResult) => {
    setResult(r)
    setChanges(r.changes)
    setError(null)
  }

  const read = async (how: 'text' | 'smart', list = shots) => {
    if (!list.length) return
    setBusy(how)
    setError(null)
    try {
      show(how === 'text' ? await window.cf.importer.screenshots(list.map((s) => s.data)) : await window.cf.importer.smart(list.map((s) => s.data)))
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
      if (msg === 'SIGN_IN') signIn('Sign in to use smart read. It reads tricky screenshots for you, a few times a day for free.')
      else setError(msg)
    } finally {
      setBusy(null)
    }
  }

  const fromObs = async () => {
    setBusy('obs')
    try { show(await window.cf.importer.obs()) } catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)) } finally { setBusy(null) }
  }

  const apply = async () => {
    const chosen = changes.filter((c) => c.on)
    if (!chosen.length) return
    setBusy('apply')
    try {
      // The main process saves and broadcasts the new settings to every page.
      await window.cf.importer.apply(changes)
      toast.push({ kind: 'success', title: `Imported ${chosen.length} setting${chosen.length === 1 ? '' : 's'}`, body: `From ${result?.found.app ?? 'your other recorder'}` })
      reset()
    } finally {
      setBusy(null)
    }
  }

  const reset = () => {
    shots.forEach((s) => URL.revokeObjectURL(s.url))
    setShots([])
    setResult(null)
    setChanges([])
    setError(null)
  }

  const nothing = result && !result.changes.length
  const thin = result && result.via === 'text' && result.changes.length < 2
  const canSmart = !!settings?.ai.anthropicApiKey || account.signedIn

  return (
    <Section
      title="Bring your settings"
      icon={<Wand2 size={16} />}
      desc="Coming from Medal, OBS or the NVIDIA App? Screenshot its settings and drop the picture here. Clutch reads it on this PC and shows you every change first."
      right={obs && !result ? (
        <button className="btn-sm" onClick={() => void fromObs()} disabled={!!busy}>
          {busy === 'obs' ? <Loader2 size={13} className="animate-spin" /> : <FileUp size={13} />} Import from OBS on this PC
        </button>
      ) : undefined}
    >
      {!result && (
        <div
          ref={zone}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void add([...e.dataTransfer.files]) }}
          className={`rounded-2xl border border-dashed px-5 py-6 flex items-center gap-5 transition-colors ${over ? 'border-accent bg-accent/[0.07]' : 'border-white/15 bg-white/[0.02]'}`}
        >
          {shots.length ? (
            <div className="flex gap-2 shrink-0">
              {shots.map((s, i) => (
                <div key={s.url} className="relative w-24 h-16 rounded-lg overflow-hidden border border-white/10 bg-black/40">
                  <img src={s.url} alt={s.name} className="w-full h-full object-cover" />
                  <button className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 grid place-items-center text-ink-2 hover:text-ink" aria-label={`Remove ${s.name}`} onClick={() => setShots(shots.filter((_, j) => j !== i))}><X size={11} /></button>
                </div>
              ))}
            </div>
          ) : (
            <span className="w-12 h-12 rounded-2xl grid place-items-center bg-white/[0.05] text-ink-2 shrink-0"><ImagePlus size={22} /></span>
          )}
          <div className="flex-1 min-w-0">
            {busy === 'text' ? (
              <p className="text-sm text-ink-2 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Reading your screenshot…</p>
            ) : (
              <>
                <p className="text-sm text-ink-2">Drop screenshots here, or press <kbd className="kbd">Ctrl</kbd> <kbd className="kbd">V</kbd> to paste one.</p>
                <p className="text-xs text-ink-3 mt-1">Tip: <kbd className="kbd">Win</kbd> <kbd className="kbd">Shift</kbd> <kbd className="kbd">S</kbd> grabs part of the screen. Up to 4 pictures, for example the Recorder and Hotkeys pages.</p>
              </>
            )}
          </div>
          <button className="btn-sm shrink-0" onClick={() => input.current?.click()} disabled={!!busy || shots.length >= 4}><ClipboardPaste size={13} /> Choose pictures</button>
          <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = '' }} />
        </div>
      )}

      {error && <p className="text-sm text-bad flex items-center gap-2"><TriangleAlert size={14} /> {error}</p>}

      {result && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            {result.via === 'obs-files' ? 'Read from your OBS profile.' : result.via === 'smart' ? 'Smart read finished.' : `Read ${result.lines ?? 0} lines of text.`}{' '}
            {nothing ? `Your Clutch settings already match ${result.found.app}, or nothing readable was found.` : `Here is what would change to match ${result.found.app}. Untick anything you want to keep.`}
          </p>

          {changes.length > 0 && (
            <ul className="rounded-2xl border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden">
              {changes.map((c, i) => (
                <li key={c.id}>
                  <label className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.03]">
                    <input type="checkbox" className="mt-1 accent-[#4fe3ff] w-4 h-4" checked={c.on} onChange={(e) => setChanges(changes.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 text-sm">
                        <span className="w-36 shrink-0 text-ink-2">{c.label}</span>
                        <span className="text-ink-3 truncate">{c.from}</span>
                        <ArrowRight size={13} className="text-ink-3 shrink-0" />
                        <span className="text-ink font-medium truncate">{c.to}</span>
                      </span>
                      {c.warn && <span className="block text-xs text-warn mt-1 ml-[152px]">{c.warn}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {result.found.notes.length > 0 && (
            <ul className="text-xs text-ink-3 space-y-1">{result.found.notes.map((n) => <li key={n}>· {n}</li>)}</ul>
          )}

          <div className="flex items-center gap-2 pt-1">
            {changes.length > 0 && (
              <button className="btn-primary h-10 px-5" onClick={() => void apply()} disabled={!!busy || !changes.some((c) => c.on)}>
                {busy === 'apply' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Apply {changes.filter((c) => c.on).length} change{changes.filter((c) => c.on).length === 1 ? '' : 's'}
              </button>
            )}
            {result.via === 'text' && shots.length > 0 && (thin || nothing) && (
              <button className="btn h-10 px-4" onClick={() => void read('smart')} disabled={!!busy} title={canSmart ? undefined : 'Needs a Clutch account'}>
                {busy === 'smart' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Missing something? Try smart read
              </button>
            )}
            <button className="btn-ghost h-10 px-4" onClick={reset} disabled={busy === 'apply'}>{changes.length ? 'Cancel' : 'Done'}</button>
          </div>
        </div>
      )}
    </Section>
  )
}
