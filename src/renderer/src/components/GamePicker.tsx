import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, X } from 'lucide-react'

interface RunningApp {
  process: string
  title: string
}

interface Props {
  value: string[]
  onChange: (v: string[]) => void
  placeholder: string
}

/**
 * Chip list + dropdown for choosing games. The dropdown offers apps with a window open right now
 * and games that already have clips, with a "type a name" escape hatch.
 */
export function GamePicker({ value, onChange, placeholder }: Props) {
  const [running, setRunning] = useState<RunningApp[]>([])
  const [clipped, setClipped] = useState<string[]>([])
  const [custom, setCustom] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const [apps, games] = await Promise.all([window.cf.system.runningApps(), window.cf.library.games()])
      setRunning(apps)
      setClipped(games.filter((g) => g !== 'Desktop'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [])

  const has = (name: string) => value.some((v) => v.toLowerCase() === name.toLowerCase())
  const add = (name: string) => {
    const n = name.trim()
    if (n && !has(n)) onChange([...value, n])
  }
  const remove = (name: string) => onChange(value.filter((v) => v !== name))

  const runningOptions = useMemo(() => running.filter((a) => !has(a.process)), [running, value])
  const clippedOptions = useMemo(() => clipped.filter((g) => !has(g)), [clipped, value])

  return (
    <div className="space-y-2">
      <div className="input flex flex-wrap gap-1.5 min-h-10 items-center">
        {value.length === 0 && custom === null && <span className="text-muted/60 text-sm">{placeholder}</span>}
        {value.map((v) => (
          <span key={v} className="chip text-ink">
            {v}
            <button className="cursor-pointer text-muted hover:text-bad" onClick={() => remove(v)} aria-label={`Remove ${v}`}><X size={12} /></button>
          </span>
        ))}
        {custom !== null && (
          <input
            autoFocus
            className="bg-transparent text-sm focus:outline-none min-w-32 flex-1"
            placeholder="Type a game or process name, press Enter"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { add(custom); setCustom(null) }
              if (e.key === 'Escape') setCustom(null)
            }}
            onBlur={() => { add(custom); setCustom(null) }}
          />
        )}
      </div>
      <div className="flex gap-2">
        <select
          className="input flex-1"
          value=""
          onChange={(e) => {
            if (e.target.value === '__custom') setCustom('')
            else if (e.target.value) add(e.target.value)
          }}
        >
          <option value="">Add a game…</option>
          {runningOptions.length > 0 && (
            <optgroup label="Running now">
              {runningOptions.map((a) => (
                <option key={a.process} value={a.process}>{a.process}{a.title ? ` — ${a.title.slice(0, 40)}` : ''}</option>
              ))}
            </optgroup>
          )}
          {clippedOptions.length > 0 && (
            <optgroup label="Games you've clipped">
              {clippedOptions.map((g) => <option key={g} value={g}>{g}</option>)}
            </optgroup>
          )}
          <optgroup label="Other">
            <option value="__custom">Type a name…</option>
          </optgroup>
        </select>
        <button className="btn" onClick={() => void refresh()} title="Rescan running apps" disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <button className="btn" onClick={() => setCustom('')} title="Type a name"><Plus size={14} /></button>
      </div>
    </div>
  )
}
