import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, X } from 'lucide-react'
import type { GameSummary, RunningApp } from '../../../shared/types'
import { fileUrl } from '../lib/store'
import { GameIcon } from './ui'

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
  const [clipped, setClipped] = useState<GameSummary[]>([])
  const [custom, setCustom] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const [apps, games] = await Promise.all([window.cf.system.runningApps(), window.cf.library.games()])
      setRunning(apps)
      setClipped(games.filter((g) => g.name !== 'Desktop'))
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
  const iconFor = (name: string) => {
    const r = running.find((a) => a.process.toLowerCase() === name.toLowerCase())
    const c = clipped.find((g) => g.name.toLowerCase() === name.toLowerCase() || g.process === name.toLowerCase())
    const p = r?.icon ?? c?.icon
    return p ? fileUrl(p) : undefined
  }

  const runningOptions = useMemo(() => running.filter((a) => !has(a.process)), [running, value]) // eslint-disable-line react-hooks/exhaustive-deps
  const clippedOptions = useMemo(() => clipped.filter((g) => !has(g.name) && !(g.process && has(g.process))), [clipped, value]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      <div className="input h-auto min-h-10 py-1.5 flex flex-wrap gap-1.5 items-center">
        {value.length === 0 && custom === null && <span className="text-ink-3/70 text-sm">{placeholder}</span>}
        {value.map((v) => (
          <span key={v} className="chip text-ink gap-1.5">
            <GameIcon src={iconFor(v)} name={v} size={14} />
            {v}
            <button className="text-ink-3 hover:text-bad" onClick={() => remove(v)} aria-label={`Remove ${v}`}><X size={12} /></button>
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
          aria-label="Add a game"
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
              {clippedOptions.map((g) => <option key={g.name} value={g.process ?? g.name}>{g.name}</option>)}
            </optgroup>
          )}
          <optgroup label="Other">
            <option value="__custom">Type a name…</option>
          </optgroup>
        </select>
        <button className="btn-icon" onClick={() => void refresh()} title="Rescan running apps" disabled={loading} aria-label="Rescan">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
        <button className="btn-icon" onClick={() => setCustom('')} title="Type a name" aria-label="Type a name"><Plus size={15} /></button>
      </div>
    </div>
  )
}
