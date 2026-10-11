import type { ReactNode } from 'react'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="text-xs text-muted mt-1.5">{hint}</p>}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 relative w-10 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-5' : 'left-1'}`} />
      </button>
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted mt-0.5">{hint}</span>}
      </span>
    </label>
  )
}

export function Section({ title, desc, children, right }: { title: string; desc?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {desc && <p className="text-sm text-muted mt-0.5">{desc}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

export function LevelMeter({ db, label }: { db?: number; label: string }) {
  const pct = db === undefined ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-14 text-muted">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-line overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${pct}%`, background: pct > 85 ? 'var(--color-bad)' : pct > 60 ? 'var(--color-warn)' : 'var(--color-ok)' }} />
      </div>
      <span className="w-14 text-right tabular-nums text-muted">{db === undefined || db <= -99 ? '—' : `${db.toFixed(0)} dB`}</span>
    </div>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-16 text-muted">
      <p className="font-medium text-ink/80">{title}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
    </div>
  )
}
