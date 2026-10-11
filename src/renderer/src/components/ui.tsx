import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Field({ label, hint, children, right }: { label: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        {right && <span className="text-xs text-ink-3 tabular">{right}</span>}
      </div>
      {children}
      {hint && <p className="text-xs text-ink-3 mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; label?: string; hint?: string; size?: 'md' | 'lg' }) {
  const id = useId()
  const w = size === 'lg' ? 'w-12 h-7' : 'w-10 h-6'
  const knob = size === 'lg' ? 'w-5 h-5 top-1' : 'w-4 h-4 top-1'
  const on = size === 'lg' ? 'left-6' : 'left-5'
  return (
    <label htmlFor={id} className="flex items-start gap-3 cursor-pointer select-none group">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 relative ${w} rounded-full transition-colors duration-200 shrink-0 ${checked ? 'bg-accent shadow-[0_0_14px_-2px_var(--color-accent)]' : 'bg-surface-4 group-hover:bg-line-strong'}`}
      >
        <span className={`absolute ${knob} rounded-full bg-white shadow transition-all duration-200 ${checked ? on : 'left-1'}`} />
      </button>
      {label && (
        <span className="min-w-0">
          <span className="text-sm font-medium">{label}</span>
          {hint && <span className="block text-xs text-ink-3 mt-0.5 leading-relaxed">{hint}</span>}
        </span>
      )}
    </label>
  )
}

export function Slider({ value, min, max, step = 1, onChange, format, label, hint }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; label: string; hint?: string }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <Field label={label} hint={hint} right={<span className="text-ink font-semibold">{format ? format(value) : value}</span>}>
      <input
        type="range"
        className="slider"
        style={{ ['--pct' as string]: `${pct}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  )
}

export function Segmented<T extends string | number>({ value, options, onChange, ariaLabel }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex p-1 rounded-[10px] bg-surface-2 border border-line gap-0.5 w-full">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex-1 h-8 px-3 rounded-md text-sm font-medium transition-all duration-150 ${value === o.value ? 'bg-surface-4 text-ink shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_2px_8px_-2px_rgba(0,0,0,0.6)]' : 'text-ink-3 hover:text-ink-2'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Section({ title, desc, children, right, icon, className = '' }: { title: string; desc?: string; children: ReactNode; right?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 space-y-4 ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          {icon && <div className="w-9 h-9 rounded-[10px] bg-surface-3 border border-line grid place-items-center text-ink-2 shrink-0">{icon}</div>}
          <div className="min-w-0">
            <h2 className="font-semibold text-[15px]">{title}</h2>
            {desc && <p className="text-sm text-ink-3 mt-0.5 leading-relaxed">{desc}</p>}
          </div>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {children}
    </section>
  )
}

export function LevelMeter({ db, label, threshold }: { db?: number; label: string; threshold?: number }) {
  const toPct = (d: number) => Math.max(0, Math.min(100, ((d + 60) / 60) * 100))
  const pct = db === undefined ? 0 : toPct(db)
  const hot = threshold !== undefined && db !== undefined && db > threshold
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-16 text-ink-3">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-surface-3 overflow-hidden relative">
        <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${pct}%`, background: pct > 88 ? 'var(--color-bad)' : hot ? 'var(--color-live)' : 'linear-gradient(90deg, var(--color-ok), #a3e635)' }} />
        {threshold !== undefined && <span className="absolute top-0 bottom-0 w-px bg-ink-2/70" style={{ left: `${toPct(threshold)}%` }} title="Trigger threshold" />}
      </div>
      <span className="w-14 text-right tabular text-ink-3">{db === undefined || db <= -99 ? '—' : `${db.toFixed(0)} dB`}</span>
    </div>
  )
}

export function Empty({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-14 px-6 fade-in">
      {icon && <div className="mx-auto w-14 h-14 rounded-2xl bg-surface-3 border border-line grid place-items-center text-ink-3 mb-4">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {hint && <p className="text-sm text-ink-3 mt-1 max-w-md mx-auto leading-relaxed">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'live' | 'accent' }) {
  const t = {
    neutral: 'bg-surface-3 text-ink-2 border-line',
    ok: 'bg-ok/10 text-ok border-ok/30',
    warn: 'bg-warn/10 text-warn border-warn/30',
    bad: 'bg-bad/10 text-bad border-bad/30',
    live: 'bg-live/10 text-live border-live/30',
    accent: 'bg-accent/15 text-accent-2 border-accent/30'
  }[tone]
  return <span className={`inline-flex items-center gap-1 px-2 h-6 rounded-md text-xs font-medium border ${t}`}>{children}</span>
}

export function Progress({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'live' | 'ok' }) {
  const bg = { accent: 'var(--color-accent)', live: 'var(--color-live)', ok: 'var(--color-ok)' }[tone]
  return (
    <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: bg }} />
    </div>
  )
}

export function Modal({ open, onClose, children, width = 'max-w-2xl', title, hideHeader }: { open: boolean; onClose: () => void; children: ReactNode; width?: string; title?: ReactNode; hideHeader?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-[2px] grid place-items-center p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" className={`card w-full ${width} max-h-[calc(100vh-48px)] overflow-hidden flex flex-col pop-in shadow-[var(--shadow-pop)]`}>
        {!hideHeader && (
          <div className="flex items-center justify-between px-5 h-14 border-b border-line shrink-0">
            <div className="font-semibold truncate">{title}</div>
            <button className="btn-ghost w-9 h-9 px-0" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        )}
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

/** Confirmation dialog hook: const [confirm, dialog] = useConfirm(); await confirm({...}) */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; body?: string; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null)
  const confirm = (opts: { title: string; body?: string; confirmLabel?: string; danger?: boolean }) => new Promise<boolean>((resolve) => setState({ ...opts, resolve }))
  const close = (v: boolean) => { state?.resolve(v); setState(null) }
  const dialog = (
    <Modal open={!!state} onClose={() => close(false)} width="max-w-md" hideHeader>
      {state && (
        <div className="p-6">
          <h3 className="font-semibold text-lg">{state.title}</h3>
          {state.body && <p className="text-sm text-ink-2 mt-2 leading-relaxed">{state.body}</p>}
          <div className="flex justify-end gap-2 mt-6">
            <button className="btn" onClick={() => close(false)} autoFocus>Cancel</button>
            <button className={state.danger ? 'btn bg-bad/15 border-bad/40 text-bad hover:bg-bad/25' : 'btn-primary'} onClick={() => close(true)}>{state.confirmLabel ?? 'Confirm'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
  return [confirm, dialog] as const
}

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return <span title={text} className="inline-flex">{children}</span>
}

/** Text that becomes an input on click. */
export function InlineEdit({ value, onSave, className = '' }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => setDraft(value), [value])
  useEffect(() => { if (editing) ref.current?.select() }, [editing])
  if (!editing) {
    return <button className={`text-left hover:bg-surface-3 rounded px-1 -mx-1 transition-colors ${className}`} onClick={() => setEditing(true)} title="Click to rename">{value}</button>
  }
  const commit = () => { setEditing(false); if (draft.trim() && draft !== value) onSave(draft.trim()) }
  return (
    <input
      ref={ref}
      className={`bg-surface-2 border border-accent rounded px-1 -mx-1 focus:outline-none ${className}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
    />
  )
}

export function GameIcon({ src, name, size = 20, className = '' }: { src?: string; name: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (src && !broken) {
    return <img src={src} alt="" width={size} height={size} className={`rounded-[5px] object-cover shrink-0 ${className}`} onError={() => setBroken(true)} />
  }
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)
  return (
    <span className={`grid place-items-center rounded-[5px] text-[10px] font-bold text-white shrink-0 ${className}`} style={{ width: size, height: size, background: `hsl(${hue} 50% 40%)` }} aria-hidden>
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
