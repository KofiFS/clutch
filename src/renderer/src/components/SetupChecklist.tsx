import { useState } from 'react'
import { ArrowRight, Check, Cloud, FolderOpen, Gamepad2, Keyboard, ListChecks, MessageSquare, Mic, Sparkles, Upload, X, Youtube } from 'lucide-react'
import { useMedalOffer } from './Libraries'
import { useStore, type Page } from '../lib/store'

interface Step {
  id: string
  label: string
  detail: string
  icon: React.ReactNode
  done: boolean
  optional?: boolean
  action: string
  run: () => void
}

/** Everything worth setting up, whether it's done, and one click to the exact setting. */
function useSteps(): Step[] {
  const { settings, status, account, goTo, signIn } = useStore()
  const medal = useMedalOffer()
  if (!settings) return []
  const c = settings.capture
  const yt = settings.upload.youtube
  const go = (page: Page, find: string) => () => goTo(page, find)
  return [
    { id: 'mic', label: 'Microphone', icon: <Mic size={16} />, done: !!c.micDevice, detail: c.micDevice || 'Not picked, so your voice is not in clips', action: 'Pick mic', run: go('settings', 'Audio sources') },
    { id: 'hotkey', label: 'Clip hotkey', icon: <Keyboard size={16} />, done: status.hotkeyRegistered !== false, detail: status.hotkeyRegistered === false ? `Another app is using ${c.clipHotkey}` : `${c.clipHotkey} saves a clip`, action: 'Fix hotkey', run: go('settings', 'Clip hotkey') },
    { id: 'auto', label: 'Record games automatically', icon: <Gamepad2 size={16} />, done: settings.app.autoStart === 'games', detail: settings.app.autoStart === 'games' ? 'Starts when a game opens' : 'Off, so you start recording yourself', action: 'Turn on', run: go('settings', 'Start recording when a game opens') },
    { id: 'discord', label: 'Discord', icon: <MessageSquare size={16} />, done: !!settings.discord.webhookUrl, detail: settings.discord.webhookUrl ? 'Clips post to your channel' : 'Post clips to a channel in one click', action: 'Connect', run: go('settings', 'Discord') },
    { id: 'youtube', label: 'YouTube', icon: <Youtube size={16} />, done: yt.connected, detail: yt.connected ? yt.channelTitle || 'Connected' : 'Upload clips straight from Clutch', action: 'Connect', run: go('settings', 'Accounts') },
    {
      id: 'account', label: 'Clutch account', icon: <Cloud size={16} />, done: account.signedIn, optional: true,
      detail: account.signedIn ? `Signed in as ${account.user?.name ?? 'you'}` : 'Share links, cloud space and auto-uploads',
      action: 'Sign in', run: account.serverUrl ? () => signIn('Sign in for share links, cloud space and scheduled uploads.') : go('settings', 'Account')
    },
    ...(medal ? [{ id: 'medal', label: 'Your Medal clips', icon: <FolderOpen size={16} />, done: false, optional: true, detail: 'Show them in Clutch without copying anything', action: 'Add', run: go('settings', 'Libraries') }] : []),
    { id: 'import', label: 'Settings from Medal or OBS', icon: <Upload size={16} />, done: false, optional: true, detail: 'Copy your old quality and hotkeys over', action: 'Import', run: go('settings', 'Bring your settings') },
    { id: 'ai', label: 'AI features', icon: <Sparkles size={16} />, done: !!settings.ai.anthropicApiKey || account.signedIn, optional: true, detail: 'Clip kills automatically and name clips', action: 'Set up', run: go('settings', 'AI') }
  ]
}

function StepRow({ s }: { s: Step }) {
  return (
    <li className="flex items-center gap-3 py-2.5 border-t border-white/[0.06]">
      <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${s.done ? 'bg-ok/15 text-ok' : 'bg-white/[0.06] text-ink-2'}`}>{s.done ? <Check size={16} strokeWidth={3} /> : s.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium flex items-center gap-2">{s.label}{s.optional && !s.done && <span className="text-[10px] text-ink-3 border border-white/12 rounded-full px-1.5 py-px">Optional</span>}</div>
        <div className="text-xs text-ink-3 truncate">{s.detail}</div>
      </div>
      <button className={s.done ? 'btn-ghost h-8 px-2.5 text-xs shrink-0' : 'btn-sm shrink-0'} onClick={s.run}>{s.done ? 'Change' : <>{s.action} <ArrowRight size={13} /></>}</button>
    </li>
  )
}

/** Settings: the full list at the top. */
export function SetupChecklist() {
  const steps = useSteps()
  if (!steps.length) return null
  const core = steps.filter((s) => !s.optional)
  const left = core.filter((s) => !s.done).length
  return (
    <section className="card p-6">
      <div className="flex items-start gap-3.5 mb-2">
        <span className="w-9 h-9 rounded-xl grid place-items-center bg-accent/15 text-accent shrink-0"><ListChecks size={17} /></span>
        <div>
          <h2 className="font-semibold text-[16px]">Setup</h2>
          <p className="text-sm text-ink-3 mt-0.5">{left ? `${core.length - left} of ${core.length} done. Click any item to jump straight to it.` : 'All set. Click any item to change it.'}</p>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-x-8">
        {steps.map((s) => <StepRow key={s.id} s={s} />)}
      </ul>
    </section>
  )
}

const HIDE_KEY = 'clutch.setupCardHidden'

/** Home: a small "finish setting up" card while something important is missing. */
export function SetupCard() {
  const { goTo } = useStore()
  const steps = useSteps()
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false } })
  const core = steps.filter((s) => !s.optional)
  const todo = core.filter((s) => !s.done)
  if (hidden || !steps.length || !todo.length) return null
  const hide = () => { setHidden(true); try { localStorage.setItem(HIDE_KEY, '1') } catch { /* private storage */ } }
  return (
    <section className="card p-5">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-9 h-9 rounded-xl grid place-items-center bg-accent/15 text-accent shrink-0"><ListChecks size={17} /></span>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-[15px]">Finish setting up</h2>
          <p className="text-xs text-ink-3">{core.length - todo.length} of {core.length} done</p>
        </div>
        <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => goTo('settings', 'Setup')}>See all</button>
        <button className="btn-ghost h-8 w-8 px-0" aria-label="Hide setup card" title="Hide (the full list stays at the top of Settings)" onClick={hide}><X size={15} /></button>
      </div>
      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden mb-3"><div className="h-full bg-accent rounded-full" style={{ width: `${((core.length - todo.length) / core.length) * 100}%` }} /></div>
      <div className="flex flex-wrap gap-2">
        {todo.map((s) => <button key={s.id} className="btn-sm" onClick={s.run}>{s.icon} {s.action === 'Connect' ? `Connect ${s.label}` : s.action === 'Turn on' ? 'Record games automatically' : s.action} <ArrowRight size={13} /></button>)}
      </div>
    </section>
  )
}
