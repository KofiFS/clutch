import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquareText, Mic, Plus, X } from 'lucide-react'
import type { VoiceCommandAction, VoiceCommandSettings } from '../../../shared/types'
import { useStore } from '../lib/store'
import { Badge, Section, Segmented, Toggle } from './ui'

const ACTIONS: { value: VoiceCommandAction; label: string }[] = [
  { value: 'clip', label: 'Save a clip' },
  { value: 'bookmark', label: 'Bookmark (long recording)' },
  { value: 'long', label: 'Start / stop long recording' }
]
const SUGGESTIONS = ['clip that', 'clip it', 'save that', 'clutch clip', 'that was crazy', 'bookmark that']
const SENSITIVITY = [
  { value: 0.7, label: 'Strict', title: 'Fewest accidental clips. Say the phrase clearly.' },
  { value: 0.55, label: 'Balanced', title: 'Recommended.' },
  { value: 0.4, label: 'Easy', title: 'Catches mumbled phrases too, with more accidental clips.' }
]

interface Heard { text: string; confidence: number; action?: VoiceCommandAction; ignored?: boolean; at: number }

/** What to clip → Voice commands: say "clip that" instead of pressing the hotkey. */
export function VoiceCommandsSettings() {
  const { settings, save, status } = useStore()
  const [testing, setTesting] = useState<number | null>(null)
  const [heard, setHeard] = useState<Heard[]>([])
  const [note, setNote] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    const off = window.cf.on('voice-heard', (h: Omit<Heard, 'at'>) => setHeard((l) => [{ ...h, at: Date.now() }, ...l].slice(0, 6)))
    return () => { off(); if (timer.current) clearTimeout(timer.current) }
  }, [])
  if (!settings) return null
  const vc = settings.voiceCommands
  const set = (patch: Partial<VoiceCommandSettings>) => void save({ voiceCommands: { ...vc, ...patch } })
  const setCommand = (i: number, patch: Partial<VoiceCommandSettings['commands'][number]>) => set({ commands: vc.commands.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const has = (p: string) => vc.commands.some((c) => c.phrase.trim().toLowerCase() === p)
  const level = SENSITIVITY.reduce((best, s) => (Math.abs(s.value - vc.minConfidence) < Math.abs(best.value - vc.minConfidence) ? s : best)).value

  const test = async () => {
    setHeard([])
    setNote(null)
    const r = await window.cf.voiceCommands.test(15)
    if (!r.mic) { setNote('Pick a microphone under Settings → Audio sources first.'); return }
    setTesting(Date.now() + r.seconds * 1000)
    timer.current = setTimeout(() => setTesting(null), r.seconds * 1000)
  }

  return (
    <Section
      title="Voice commands"
      icon={<MessageSquareText size={16} />}
      desc="Say a phrase to clip, like a hotkey you don't have to press. Clutch listens to your mic only while it's recording, using Windows' built-in speech recognition (English). Nothing leaves your PC."
      right={<div className="flex items-center gap-3"><Badge tone="ok">Offline</Badge><Toggle size="lg" checked={vc.enabled} onChange={(enabled) => set({ enabled })} label={vc.enabled ? 'On' : 'Off'} /></div>}
    >
      <div className="space-y-2">
        {vc.commands.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-ink-3 text-sm w-7 shrink-0">Say</span>
            <PhraseInput value={c.phrase} onCommit={(phrase) => setCommand(i, { phrase })} />
            <span className="text-ink-3 text-sm shrink-0">to</span>
            <select className="input w-60 shrink-0" value={c.action} onChange={(e) => setCommand(i, { action: e.target.value as VoiceCommandAction })} aria-label={`What "${c.phrase}" does`}>
              {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <button className="btn-ghost h-9 w-9 px-0 shrink-0" disabled={vc.commands.length <= 1} title={vc.commands.length <= 1 ? 'Keep at least one phrase (turn voice commands off instead)' : 'Remove this phrase'} aria-label={`Remove "${c.phrase}"`} onClick={() => set({ commands: vc.commands.filter((_, j) => j !== i) })}><X size={15} /></button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button className="btn-sm" disabled={vc.commands.length >= 8} onClick={() => set({ commands: [...vc.commands, { phrase: SUGGESTIONS.find((s) => !has(s)) ?? 'new phrase', action: 'clip' }] })}><Plus size={13} /> Add phrase</button>
          {SUGGESTIONS.filter((s) => !has(s)).slice(0, 4).map((s) => (
            <button key={s} className="chip hover:border-line-strong" disabled={vc.commands.length >= 8} onClick={() => set({ commands: [...vc.commands, { phrase: s, action: s.startsWith('bookmark') ? 'bookmark' : 'clip' }] })}>“{s}”</button>
          ))}
        </div>
        <p className="text-xs text-ink-3">Short, unusual phrases work best. Two or three words like “clip that” beat a single word, which you might say by accident.</p>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-6 items-end">
        <div>
          <div className="label">How sure Clutch must be</div>
          <Segmented value={level} onChange={(minConfidence) => set({ minConfidence })} options={SENSITIVITY} ariaLabel="Voice command sensitivity" />
        </div>
        <button className="btn" disabled={!!testing} onClick={() => void test()}>{testing ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />} {testing ? 'Listening…' : 'Test my mic'}</button>
      </div>

      {(testing || heard.length > 0 || note) && (
        <div className="card-2 p-3.5 space-y-1.5">
          <div className="text-xs text-ink-3">{note ?? (testing ? 'Say your phrase, and talk normally too: only the green lines would trigger.' : 'What Clutch heard:')}</div>
          {heard.map((h) => (
            <div key={h.at} className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full shrink-0 ${h.action ? 'bg-ok' : h.ignored ? 'bg-warn' : 'bg-ink-3'}`} />
              <span className={h.action ? 'text-ink font-medium' : 'text-ink-2'}>“{h.text}”</span>
              <span className="text-xs text-ink-3 tabular">{Math.round(h.confidence * 100)}%</span>
              <span className="text-xs text-ink-3">{h.action ? `→ ${ACTIONS.find((a) => a.value === h.action)?.label}` : h.ignored ? '→ not sure enough (try Easy, or say it more clearly)' : '→ normal talk, ignored'}</span>
            </div>
          ))}
          {testing && !heard.length && <div className="text-sm text-ink-3">Listening…</div>}
        </div>
      )}
      {vc.enabled && !status.running && !testing && <p className="text-xs text-ink-3">Voice commands start listening when recording starts.</p>}
    </Section>
  )
}

/** Saves on blur / Enter, so the listener isn't restarted on every keystroke. */
function PhraseInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const clean = draft.replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40)
    if (clean.length >= 2 && clean !== value) onCommit(clean)
    else setDraft(value)
  }
  return <input className="input flex-1 min-w-0" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} aria-label="Phrase" />
}
