import { useState } from 'react'
import { Keyboard } from 'lucide-react'
import { Kbd } from './ui'

/** Press-to-record hotkey field that produces an Electron accelerator string. */
export function HotkeyInput({ value, onChange, status }: { value: string; onChange: (accel: string) => void; status?: 'ok' | 'conflict' | 'unknown' }) {
  const [listening, setListening] = useState(false)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!listening) return
    e.preventDefault()
    if (e.key === 'Escape') { setListening(false); return }
    const mods: string[] = []
    if (e.ctrlKey) mods.push('Ctrl')
    if (e.altKey) mods.push('Alt')
    if (e.shiftKey) mods.push('Shift')
    if (e.metaKey) mods.push('Super')
    const k = e.key
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(k)) return
    let key = k
    if (/^f\d{1,2}$/i.test(k)) key = k.toUpperCase()
    else if (k.length === 1) key = k.toUpperCase()
    else if (k === ' ') key = 'Space'
    else if (k === 'ArrowUp') key = 'Up'
    else if (k === 'ArrowDown') key = 'Down'
    else if (k === 'ArrowLeft') key = 'Left'
    else if (k === 'ArrowRight') key = 'Right'
    else if (k.startsWith('Numpad')) key = 'num' + k.slice(6)
    // Letters/digits without a modifier would hijack typing in games; require a modifier or an F-key.
    if (!mods.length && !/^F\d{1,2}$/.test(key) && !/^(Insert|Home|End|PageUp|PageDown|Delete|Pause|ScrollLock|PrintScreen)$/.test(key)) return
    onChange([...mods, key].join('+'))
    setListening(false)
  }

  const parts = value ? value.split('+') : []
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={`input flex items-center gap-2 cursor-pointer ${listening ? 'border-accent shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_25%,transparent)]' : ''}`}
        onClick={() => setListening(true)}
        onBlur={() => setListening(false)}
        onKeyDown={onKeyDown}
        aria-label="Clip hotkey"
      >
        <Keyboard size={16} className="text-ink-3" />
        {listening ? (
          <span className="text-ink-2 text-sm">Press a key combination…</span>
        ) : parts.length ? (
          <span className="flex items-center gap-1">{parts.map((p) => <Kbd key={p}>{p}</Kbd>)}</span>
        ) : (
          <span className="text-ink-3 text-sm">Click to set</span>
        )}
        {status === 'ok' && !listening && <span className="ml-auto text-xs text-ok">Ready</span>}
        {status === 'conflict' && !listening && <span className="ml-auto text-xs text-bad">In use by another app</span>}
      </button>
      {value && <button className="btn" onClick={() => onChange('')} type="button">Clear</button>}
    </div>
  )
}
