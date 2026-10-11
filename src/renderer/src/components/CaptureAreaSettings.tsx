import { useEffect, useState } from 'react'
import { AppWindow, Crop, Gamepad2, HardDrive, Monitor, FolderOpen, RotateCcw } from 'lucide-react'
import type { CaptureArea, MonitorInfo, RunningApp } from '../../../shared/types'
import { fmtBytes, fileUrl, useStore } from '../lib/store'
import { Field, GameIcon, Section } from './ui'
import { useToast } from './Toasts'

type Kind = CaptureArea['kind']

const KINDS: { kind: Kind; label: string; icon: typeof Monitor; hint: string }[] = [
  { kind: 'monitor', label: 'Full screen', icon: Monitor, hint: 'Everything on the monitor.' },
  { kind: 'game', label: 'Game window', icon: Gamepad2, hint: 'Crops to the game in front when recording starts. Fullscreen games record the whole screen.' },
  { kind: 'window', label: 'A window', icon: AppWindow, hint: 'Crops to one app’s window. If you move the window, restart recording.' },
  { kind: 'region', label: 'Custom area', icon: Crop, hint: 'Drag a rectangle on screen, or use a preset.' }
]

/** "What part of the screen to record", OBS-style but in four clicks. */
export function CaptureAreaSettings() {
  const { settings, save, status } = useStore()
  const toast = useToast()
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])
  const [apps, setApps] = useState<RunningApp[]>([])
  useEffect(() => {
    void window.cf.capture.monitors().then(setMonitors)
    void window.cf.system.runningApps().then(setApps)
  }, [])
  if (!settings) return null
  const c = settings.capture
  const area = c.area ?? { kind: 'monitor' as const }
  const mon = monitors[Math.min(c.monitorIndex, Math.max(0, monitors.length - 1))]
  const setArea = (a: CaptureArea) => save({ capture: { ...c, area: a } })
  const W = mon?.width ?? 1920
  const H = mon?.height ?? 1080
  const even = (n: number) => Math.floor(n / 2) * 2

  const presets = [
    { label: '16:9 centered', r: () => { const h = H; const w = Math.min(W, even((h * 16) / 9)); return { x: even((W - w) / 2), y: 0, w, h } } },
    { label: 'Left half', r: () => ({ x: 0, y: 0, w: even(W / 2), h: H }) },
    { label: 'Right half', r: () => ({ x: even(W / 2), y: 0, w: even(W / 2), h: H }) },
    { label: 'Center 1080p', r: () => { const w = Math.min(W, 1920), h = Math.min(H, 1080); return { x: even((W - w) / 2), y: even((H - h) / 2), w, h } } }
  ]

  const choose = async (kind: Kind) => {
    if (kind === 'monitor') await setArea({ kind: 'monitor' })
    else if (kind === 'game') await setArea({ kind: 'game' })
    else if (kind === 'window') {
      const first = apps[0]
      await setArea(area.kind === 'window' ? area : { kind: 'window', process: first?.process ?? '', title: first?.title ?? '' })
    } else if (kind === 'region') {
      if (area.kind !== 'region') await setArea({ kind: 'region', ...presets[0].r(), label: presets[0].label })
    }
  }
  const pick = async () => {
    const r = await window.cf.capture.pickRegion(c.monitorIndex)
    if (r) { await setArea({ kind: 'region', ...r, label: 'Custom area' }); toast.push({ kind: 'success', title: `Recording area set to ${r.w} x ${r.h}` }) }
  }
  const kindInfo = KINDS.find((k) => k.kind === area.kind) ?? KINDS[0]

  // Preview rectangle (as a fraction of the monitor)
  const box = area.kind === 'region' ? { x: area.x / W, y: area.y / H, w: area.w / W, h: area.h / H } : area.kind === 'monitor' ? { x: 0, y: 0, w: 1, h: 1 } : null

  return (
    <Section
      title="Recording area"
      icon={<Crop size={16} />}
      desc="Pick what part of the screen ends up in your clips."
      right={status.running ? <button className="btn-sm" onClick={() => void window.cf.capture.restart()}><RotateCcw size={13} /> Apply now</button> : undefined}
    >
      <div className="grid grid-cols-[1fr_300px] gap-6">
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Recording area">
            {KINDS.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                role="radio"
                aria-checked={area.kind === kind}
                onClick={() => void choose(kind)}
                className={`card-2 flex flex-col items-center gap-2 py-3.5 px-2 text-sm font-medium transition-all ${area.kind === kind ? 'shadow-[0_0_0_1px_rgba(79,227,255,0.6),0_0_24px_-6px_rgba(79,227,255,0.8)] text-ink' : 'text-ink-2 hover:text-ink'}`}
              >
                <Icon size={20} className={area.kind === kind ? 'text-accent' : ''} />
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-3">{kindInfo.hint}</p>

          {monitors.length > 1 && (
            <Field label="Monitor">
              <select className="input" value={c.monitorIndex} onChange={(e) => void save({ capture: { ...c, monitorIndex: Number(e.target.value) } })}>
                {monitors.map((m) => <option key={m.index} value={m.index}>{m.label} · {m.width}x{m.height}{m.primary ? ' · main' : ''}</option>)}
              </select>
            </Field>
          )}

          {area.kind === 'window' && (
            <Field label="Window">
              <select
                className="input"
                value={area.process}
                onChange={(e) => { const a = apps.find((x) => x.process === e.target.value); if (a) void setArea({ kind: 'window', process: a.process, title: a.title }) }}
              >
                {!apps.some((a) => a.process === area.process) && area.process && <option value={area.process}>{area.title || area.process} (not open)</option>}
                {apps.map((a) => <option key={a.process} value={a.process}>{a.process}{a.title ? ` — ${a.title.slice(0, 50)}` : ''}</option>)}
              </select>
            </Field>
          )}

          {area.kind === 'region' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <button className="btn-primary h-9" onClick={() => void pick()}><Crop size={15} /> Select area on screen</button>
                {presets.map((p) => (
                  <button key={p.label} className={`chip h-8 px-3 ${area.label === p.label ? 'text-ink border-accent/60' : 'hover:text-ink'}`} onClick={() => void setArea({ kind: 'region', ...p.r(), label: p.label })}>{p.label}</button>
                ))}
              </div>
              <p className="text-xs text-ink-3 font-hud tracking-[0.06em]">{area.w} x {area.h} at {area.x}, {area.y}</p>
            </div>
          )}
        </div>

        {/* Live preview of what gets recorded */}
        <div>
          <span className="label">Preview</span>
          <div className="relative rounded-xl overflow-hidden border border-white/12" style={{ aspectRatio: `${W} / ${H}`, background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.03) 0 8px, transparent 8px 16px), rgba(0,10,25,0.5)' }}>
            {box ? (
              <div className="absolute rounded-md border-2 border-accent shadow-[0_0_18px_rgba(79,227,255,0.6)]" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, background: 'rgba(79,227,255,0.12)' }} />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-center px-3">
                <div className="flex flex-col items-center gap-1.5 text-xs text-ink-2">
                  {area.kind === 'window' ? (
                    <>
                      <GameIcon src={apps.find((a) => a.process === area.process)?.icon ? fileUrl(apps.find((a) => a.process === area.process)!.icon!) : undefined} name={area.title || area.process || '?'} size={28} />
                      Follows {area.title || area.process}
                    </>
                  ) : (
                    <>
                      <Gamepad2 size={24} className="text-accent" />
                      Follows the game in front
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <p className="text-[11px] text-ink-3 mt-2">{mon ? `${mon.width} x ${mon.height}` : ''}{status.running && status.areaLabel ? ` · now recording: ${status.areaLabel}` : ''}</p>
        </div>
      </div>
    </Section>
  )
}

/** Where clips go and how much space they take. */
export function StorageSettings() {
  const { settings, save, libraryVersion } = useStore()
  const [stats, setStats] = useState<{ count: number; bytes: number; seconds: number; trashed: number } | null>(null)
  useEffect(() => { void window.cf.library.stats().then(setStats) }, [libraryVersion])
  if (!settings) return null
  const c = settings.capture
  return (
    <Section title="Storage" icon={<HardDrive size={16} />} desc="Where Clutch saves your clips and long recordings. Each game gets its own folder.">
      <Field label="Save clips to" hint="New clips go here. Clips you already have stay where they are and still show in your library.">
        <div className="flex gap-2">
          <input className="input font-mono text-[13px]" readOnly value={c.outputDir} aria-label="Clips folder" />
          <button className="btn shrink-0" onClick={() => void window.cf.settings.pickFolder().then((d) => { if (d) void save({ capture: { ...c, outputDir: d } }) })}><FolderOpen size={15} /> Change…</button>
          <button className="btn shrink-0" onClick={() => void window.cf.library.openFolder()}>Open</button>
        </div>
      </Field>
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {[[String(stats.count), 'Clips'], [fmtBytes(stats.bytes), 'Used by clips'], [String(stats.trashed), 'In trash']].map(([v, l]) => (
            <div key={l} className="card-2 px-4 py-3 flex items-baseline justify-between">
              <span className="font-hud text-[9px] uppercase tracking-[0.18em] text-ink-3">{l}</span>
              <span className="font-hud text-[15px] font-bold tabular">{v}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
