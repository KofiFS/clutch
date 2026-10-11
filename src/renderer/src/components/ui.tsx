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

export function Toggle({ checked, onChange, label, hint, size = 'md', ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; label?: string; hint?: string; size?: 'md' | 'lg'; ariaLabel?: string }) {
  const id = useId()
  const w = size === 'lg' ? 'w-[52px] h-[30px]' : 'w-11 h-[26px]'
  const knob = size === 'lg' ? 'w-[24px] h-[24px] top-[2px]' : 'w-5 h-5 top-[2px]'
  const on = size === 'lg' ? 'left-[24px]' : 'left-[20px]'
  return (
    <label htmlFor={id} className="flex items-start gap-3 cursor-pointer select-none group">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label ?? ariaLabel}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 relative ${w} rounded-full transition-all duration-300 shrink-0 border ${checked ? 'border-white/40' : 'border-white/12 group-hover:border-white/25'}`}
        style={{
          background: checked ? 'linear-gradient(180deg, #8ff1ff, #2bb8ff)' : 'rgba(0,10,25,0.45)',
          boxShadow: checked ? 'inset 0 1px 1px rgba(255,255,255,0.8), 0 0 18px -2px rgba(79,227,255,0.8)' : 'inset 0 1px 3px rgba(0,0,0,0.5)'
        }}
      >
        <span
          className={`absolute ${knob} rounded-full transition-all duration-300 ${checked ? on : 'left-[2px]'}`}
          style={{ background: 'radial-gradient(circle at 35% 30%, #fff, #e6f6ff 55%, #c5e6f7)', boxShadow: '0 2px 6px rgba(0,0,0,0.45), inset 0 -1px 1px rgba(0,0,0,0.12)', transitionTimingFunction: 'var(--ease-spring)' }}
        />
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
  const idx = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="relative inline-flex p-1 rounded-full w-full border border-white/10" style={{ background: 'rgba(0,10,25,0.4)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.45)' }}>
      {/* Sliding glass lens behind the selected option */}
      <span
        aria-hidden
        className="absolute top-1 bottom-1 rounded-full liquid transition-all duration-300"
        style={{
          left: `calc(${(idx / options.length) * 100}% + 4px)`,
          width: `calc(${100 / options.length}% - 8px)`,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08))',
          boxShadow: 'inset 0 1px 0.5px rgba(255,255,255,0.6), inset 0 -1px 0.5px rgba(255,255,255,0.1), 0 4px 14px -4px rgba(0,0,0,0.6), 0 0 14px -4px rgba(79,227,255,0.5)',
          transitionTimingFunction: 'var(--ease-spring)'
        }}
      />
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`relative z-10 flex-1 h-8 px-3 rounded-full text-sm font-medium transition-colors duration-200 ${value === o.value ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Section({ title, desc, children, right, icon, className = '', hud = true }: { title: string; desc?: string; children: ReactNode; right?: ReactNode; icon?: ReactNode; className?: string; hud?: boolean }) {
  return (
    <section className={`card ${hud ? 'hud' : ''} p-6 space-y-5 ${className}`}>
      <div className="relative z-[2] flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          {icon && <IconOrb>{icon}</IconOrb>}
          <div className="min-w-0">
            <h2 className="font-semibold text-[16px]">{title}</h2>
            {desc && <p className="text-sm text-ink-3 mt-0.5 leading-relaxed">{desc}</p>}
          </div>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div className="relative z-[2] space-y-5">{children}</div>
    </section>
  )
}

/** Small glass orb holding an icon (like an iOS 26 app icon). */
export function IconOrb({ children, tone = 'cyan', size = 36 }: { children: ReactNode; tone?: 'cyan' | 'violet' | 'warn' | 'ok' | 'bad' | 'neutral'; size?: number }) {
  const c = { cyan: '79,227,255', violet: '155,123,255', warn: '255,200,87', ok: '78,242,176', bad: '255,107,139', neutral: '180,195,217' }[tone]
  return (
    <span
      className="grid place-items-center shrink-0 rounded-[12px] border"
      style={{
        width: size,
        height: size,
        color: `rgb(${c})`,
        borderColor: `rgba(${c},0.35)`,
        background: `radial-gradient(120% 120% at 30% 20%, rgba(${c},0.32), rgba(${c},0.06) 60%, rgba(255,255,255,0.03))`,
        boxShadow: `inset 0 1px 0.5px rgba(255,255,255,0.45), 0 0 18px -6px rgba(${c},0.8)`
      }}
    >
      {children}
    </span>
  )
}

/** LED-segment level meter with an optional trigger-threshold marker. */
export function LevelMeter({ db, label, threshold }: { db?: number; label: string; threshold?: number }) {
  const SEG = 28
  const toPct = (d: number) => Math.max(0, Math.min(1, (d + 60) / 60))
  const lit = db === undefined ? 0 : Math.round(toPct(db) * SEG)
  const thIdx = threshold === undefined ? -1 : Math.round(toPct(threshold) * SEG)
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-16 font-hud text-[10px] uppercase tracking-[0.14em] text-ink-3">{label}</span>
      <div className="flex-1 flex gap-[3px] h-3.5 items-stretch" aria-label={`${label} level`}>
        {Array.from({ length: SEG }, (_, i) => {
          const on = i < lit
          const color = i >= SEG - 3 ? '255,107,139' : i >= SEG - 8 ? '255,200,87' : thIdx >= 0 && i >= thIdx ? '155,123,255' : '79,227,255'
          return (
            <span
              key={i}
              className="flex-1 rounded-[3px] transition-[background-color,box-shadow] duration-100"
              style={{
                background: on ? `rgba(${color},0.95)` : 'rgba(255,255,255,0.06)',
                boxShadow: on ? `0 0 8px rgba(${color},0.7)` : 'inset 0 1px 1px rgba(0,0,0,0.4)',
                outline: i === thIdx ? '1px solid rgba(255,255,255,0.6)' : undefined,
                outlineOffset: 1
              }}
            />
          )
        })}
      </div>
      <span className="w-14 text-right tabular font-hud text-[11px] text-ink-2">{db === undefined || db <= -99 ? '--' : `${db.toFixed(0)}dB`}</span>
    </div>
  )
}

/** Circular HUD gauge (buffer fill, progress). */
export function RingGauge({ value, max, size = 132, label, sub, tone = 'cyan' }: { value: number; max: number; size?: number; label: ReactNode; sub?: ReactNode; tone?: 'cyan' | 'violet' }) {
  const r = size / 2 - 12
  const c = 2 * Math.PI * r
  const pct = max ? Math.max(0, Math.min(1, value / max)) : 0
  const col = tone === 'cyan' ? '#4fe3ff' : '#9b7bff'
  const ticks = 60
  const mid = size / 2
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <defs>
          <linearGradient id="cf-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9b7bff" />
            <stop offset="100%" stopColor={col} />
          </linearGradient>
        </defs>
        {Array.from({ length: ticks }, (_, i) => {
          const a = (i / ticks) * Math.PI * 2
          const r1 = r + 7
          const r2 = r + (i % 5 === 0 ? 11 : 9)
          return <line key={i} x1={mid + Math.cos(a) * r1} y1={mid + Math.sin(a) * r1} x2={mid + Math.cos(a) * r2} y2={mid + Math.sin(a) * r2} stroke={i / ticks < pct ? col : 'rgba(255,255,255,0.14)'} strokeWidth={1.2} />
        })}
        <circle cx={mid} cy={mid} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={6} />
        <circle cx={mid} cy={mid} r={r} fill="none" stroke="url(#cf-ring)" strokeWidth={6} strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} style={{ filter: `drop-shadow(0 0 6px ${col})`, transition: 'stroke-dasharray 0.6s var(--ease-out)' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-hud text-[26px] font-bold leading-none glow-text tabular">{label}</div>
          {sub && <div className="font-hud text-[9px] uppercase tracking-[0.18em] text-ink-3 mt-1.5">{sub}</div>}
        </div>
      </div>
    </div>
  )
}

export function Empty({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-14 px-6 fade-in">
      {icon && <div className="mx-auto mb-4 w-fit"><IconOrb size={56} tone="neutral">{icon}</IconOrb></div>}
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
    neutral: 'bg-white/8 text-ink-2 border-white/15',
    ok: 'bg-ok/12 text-ok border-ok/35',
    warn: 'bg-warn/12 text-warn border-warn/35',
    bad: 'bg-bad/12 text-bad border-bad/35',
    live: 'bg-live/12 text-live border-live/40',
    accent: 'bg-violet/15 text-[#c9b8ff] border-violet/40'
  }[tone]
  return <span className={`inline-flex items-center gap-1.5 px-2.5 h-6 rounded-full font-hud text-[10px] font-medium uppercase tracking-[0.12em] border backdrop-blur ${t}`} style={{ boxShadow: 'inset 0 1px 0.5px rgba(255,255,255,0.25)' }}>{children}</span>
}

export function Progress({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'live' | 'ok' }) {
  const bg = { accent: '#4fe3ff', live: '#4fe3ff', ok: '#4ef2b0' }[tone]
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)', boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.4)' }}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: `linear-gradient(90deg, #9b7bff, ${bg})`, boxShadow: `0 0 10px ${bg}` }} />
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
    <div className="fixed inset-0 z-[100] bg-[rgba(2,6,16,0.55)] backdrop-blur-md grid place-items-center p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
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
