import { useEffect, useState } from 'react'
import { Gamepad2, Headphones, Layers, Mic, Plus, Trash2, Volume2, VolumeX, AppWindow, MessageSquare } from 'lucide-react'
import type { AudioSource } from '../../../shared/types'
import { useLevels } from '../lib/levels'
import { useStore } from '../lib/store'
import { LevelMeter, Section, Toggle } from './ui'

/** Live meter for one source: 'mic' = trigger mics combined, 'system' = desktop audio, otherwise a source id. */
export function LiveMeter({ source, label, threshold }: { source: 'mic' | 'system' | string; label: string; threshold?: number }) {
  const l = useLevels()
  const db = !l ? undefined : source === 'mic' ? l.micDb : source === 'system' ? l.sysDb : l.sources[source]
  return <LevelMeter label={label} db={db} threshold={threshold} />
}

const VIRTUAL = /cable|voicemeeter|vb-audio|virtual|stereo mix|wave link|broadcast/i

/**
 * OBS-style audio sources, simplified: every source is mixed into the main track; flip
 * "Separate track" to also keep it on its own track for editing later.
 */
export function AudioSources() {
  const { settings, save } = useStore()
  const [devices, setDevices] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [picking, setPicking] = useState(false)
  const [apps, setApps] = useState<{ process: string; title: string }[] | null>(null)
  useEffect(() => { if (picking) { setApps(null); void window.cf.system.runningApps().then((a) => setApps(a.filter((x) => !/^(electron|clutch|explorer)$/i.test(x.process)))) } }, [picking])
  const refresh = async () => { setLoading(true); try { setDevices(await window.cf.system.audioDevices()) } finally { setLoading(false) } }
  useEffect(() => { void refresh() }, [])
  if (!settings) return null
  const c = settings.capture
  const sources = c.audioSources ?? []
  const set = (next: AudioSource[]) => save({ capture: { ...c, audioSources: next } })
  const update = (id: string, patch: Partial<AudioSource>) => set(sources.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const used = new Set(sources.map((x) => x.device).filter(Boolean))
  const addMic = () => {
    const device = devices.find((d) => !used.has(d)) ?? devices[0] ?? ''
    const n = sources.filter((x) => x.kind === 'mic').length + 1
    const id = `mic${Date.now().toString(36)}`
    const name = VIRTUAL.test(device) ? device.replace(/\s*\(.*\)\s*$/, '') : n === 1 ? 'Microphone' : `Microphone ${n}`
    void set([...sources, { id, kind: 'mic', device, name, enabled: true, volume: 1, ownTrack: false, trigger: !VIRTUAL.test(device) }])
  }
  const addApp = (process: string, name: string) => {
    const p = process.toLowerCase().replace(/\.exe$/, '')
    if (sources.some((x) => x.kind === 'app' && x.process === p)) return
    void set([...sources, { id: `app${Date.now().toString(36)}`, kind: 'app', process: p, name, enabled: true, volume: 1, ownTrack: true, inMix: false }])
    setPicking(false)
  }
  const hasDiscord = sources.some((x) => x.kind === 'app' && x.process === 'discord')
  const tracks = 1 + sources.filter((x) => x.enabled && (x.ownTrack || x.kind === 'app')).length

  return (
    <Section
      title="Audio sources"
      icon={<Headphones size={16} />}
      desc="Everything here is mixed into one track that plays everywhere. Turn on “Separate track” to also keep a source on its own, so you can turn it up or down later in an editor."
      right={<span className="chip h-7 px-3"><Layers size={12} /> {tracks} track{tracks > 1 ? 's' : ''}</span>}
    >
      <div className="space-y-2.5">
        {sources.map((src) => {
          const isDesktop = src.kind === 'desktop'
          const isApp = src.kind === 'app'
          const missing = src.kind === 'mic' && !!src.device && devices.length > 0 && !devices.includes(src.device)
          return (
            <div key={src.id} className={`card-2 p-3.5 transition-opacity ${src.enabled ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-3">
                <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 border ${src.enabled ? 'text-accent border-accent/35 bg-accent/10' : 'text-ink-3 border-white/10 bg-white/5'}`}>
                  {isDesktop ? <Gamepad2 size={17} /> : isApp ? <AppWindow size={17} /> : <Mic size={17} />}
                </span>
                <div className="min-w-0 flex-1 grid grid-cols-[minmax(0,200px)_minmax(0,1fr)] gap-3 items-center">
                  <input
                    className="bg-transparent text-sm font-semibold focus:outline-none focus:bg-white/5 rounded px-1 -mx-1 min-w-0"
                    defaultValue={src.name}
                    aria-label="Source name"
                    onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== src.name) void update(src.id, { name }) }}
                  />
                  {isDesktop ? (
                    <span className="text-xs text-ink-3 truncate">Everything you hear: game, Discord, music (Windows loopback)</span>
                  ) : isApp ? (
                    <span className="text-xs text-ink-3 truncate">Only {src.process}.exe and its helpers, on its own track. No virtual cable needed.</span>
                  ) : (
                    <select className="input h-9" value={src.device} onChange={(e) => void update(src.id, { device: e.target.value, trigger: !VIRTUAL.test(e.target.value) && src.trigger !== false })} aria-label="Device">
                      {src.device && !devices.includes(src.device) && <option value={src.device}>{src.device} (not plugged in)</option>}
                      {devices.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  )}
                </div>
                <Toggle checked={src.enabled} onChange={(enabled) => void update(src.id, { enabled })} ariaLabel={`${src.enabled ? 'Disable' : 'Enable'} ${src.name}`} />
                {!isDesktop && (
                  <button className="btn-ghost h-9 w-9 px-0 text-ink-3 hover:text-bad" aria-label={`Remove ${src.name}`} onClick={() => void set(sources.filter((x) => x.id !== src.id))}><Trash2 size={15} /></button>
                )}
              </div>
              {src.enabled && (
                <div className="mt-3 pl-12 grid grid-cols-[minmax(0,1fr)_220px] gap-5 items-center">
                  <div className="space-y-1.5">
                    <LiveMeter source={isDesktop ? 'system' : src.id} label="Level" />
                    {missing && <p className="text-[11px] text-warn">Not plugged in. Recording continues without it.</p>}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button className="text-ink-3 hover:text-ink shrink-0" aria-label={src.volume === 0 ? 'Unmute' : 'Mute'} onClick={() => void update(src.id, { volume: src.volume === 0 ? 1 : 0 })}>{src.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
                    <input
                      type="range"
                      className="slider"
                      min={0}
                      max={2}
                      step={0.05}
                      value={src.volume}
                      aria-label={`${src.name} volume`}
                      style={{ ['--pct' as string]: `${(src.volume / 2) * 100}%` }}
                      onChange={(e) => void update(src.id, { volume: Number(e.target.value) })}
                    />
                    <span className="font-hud text-[11px] tabular w-11 text-right">{Math.round(src.volume * 100)}%</span>
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-x-6 gap-y-2">
                    {isApp
                      ? <Toggle checked={!!src.inMix} onChange={(inMix) => void update(src.id, { inMix })} label="Also in the main mix" hint="Usually off: game & voice chat audio already includes it." />
                      : <Toggle checked={src.ownTrack} onChange={(ownTrack) => void update(src.id, { ownTrack })} label="Separate track" />}
                    {src.kind === 'mic' && <Toggle checked={src.trigger !== false} onChange={(trigger) => void update(src.id, { trigger })} label="Counts as my voice" hint="Used by the hype and “when I talk” triggers." />}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn" onClick={addMic} disabled={!devices.length}><Plus size={15} /> Add microphone or input</button>
        {!hasDiscord && <button className="btn" onClick={() => addApp('discord', 'Discord')}><MessageSquare size={15} /> Add Discord</button>}
        <div className="relative">
          <button className="btn" onClick={() => setPicking(!picking)} aria-expanded={picking}><AppWindow size={15} /> Add an app's audio</button>
          {picking && (
            <div className="absolute z-40 left-0 top-12 w-[320px] max-h-[300px] overflow-y-auto rounded-xl p-1.5 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.9)]" style={{ background: 'var(--color-card-2)' }} role="menu">
              {apps === null && <p className="px-3 py-3 text-sm text-ink-3">Looking at open apps…</p>}
              {apps?.map((a) => (
                <button key={a.process} role="menuitem" className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[0.07] text-sm" onClick={() => addApp(a.process, a.process === 'Discord' ? 'Discord' : a.title.length < 30 ? a.title : a.process)}>
                  <span className="block truncate">{a.title || a.process}</span>
                  <span className="block text-[11px] text-ink-3">{a.process}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="btn-ghost text-sm" onClick={() => void refresh()} disabled={loading}>{loading ? 'Looking…' : 'Rescan devices'}</button>
      </div>
      <p className="text-xs text-ink-3 leading-relaxed">
        Want Discord or music on its own track? Add it as an app above: Clutch records just that app's sound (Windows 10 2004 or newer), no virtual cable or setup needed. Virtual cables still work as inputs if you already use them.
      </p>
    </Section>
  )
}
