import { useEffect, useState } from 'react'
import { Check, Cloud, Crown, Gamepad2, Loader2, LogOut, MessageSquare, Sparkles, Twitch, UserRound, X, Youtube } from 'lucide-react'
import type { AdCard } from '../../../shared/types'
import { PLAN_ROWS } from '../../../shared/types'
import { fmtBytes, useStore } from '../lib/store'
import { Badge, Field, Modal, Progress, Section, Toggle } from './ui'
import { useToast } from './Toasts'

const providerIcon = (id: string) => (id === 'discord' ? <MessageSquare size={18} /> : id === 'google' ? <Youtube size={18} /> : id === 'twitch' ? <Twitch size={18} /> : <UserRound size={18} />)
const providerStyle = (id: string) =>
  id === 'discord' ? 'bg-[#5865F2] border-[#5865F2] text-white hover:bg-[#4752c4]' : id === 'google' ? 'bg-white border-white text-[#1f1f1f] hover:bg-[#f1f1f1]' : id === 'twitch' ? 'bg-[#9146FF] border-[#9146FF] text-white hover:bg-[#7c3aed]' : ''
const providerLabel = (id: string, label: string) => (id === 'google' ? 'Continue with Google / YouTube' : id === 'dev' ? label : `Continue with ${label}`)

/** Sign-in buttons for every provider the server has set up. */
function ProviderButtons({ onDone }: { onDone?: () => void }) {
  const toast = useToast()
  const [providers, setProviders] = useState<{ id: string; label: string }[] | null>(null)
  const [busy, setBusy] = useState('')
  useEffect(() => { void window.cf.account.providers().then(setProviders) }, [])
  if (providers === null) return <div className="h-11 shimmer rounded-full" />
  if (!providers.length) return <p className="text-sm text-ink-3">This Clutch server has no sign-in providers set up yet.</p>
  return (
    <div className="space-y-2.5">
      {providers.map((p) => (
        <button
          key={p.id}
          disabled={!!busy}
          className={`btn w-full h-11 ${providerStyle(p.id)}`}
          onClick={async () => {
            setBusy(p.id)
            try {
              const st = await window.cf.account.signIn(p.id)
              toast.push({ kind: 'success', title: `Signed in as ${st.user?.name ?? 'you'}` })
              onDone?.()
            } catch (e) {
              toast.push({ kind: 'error', title: 'Sign-in did not finish', body: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': Error: /, '') })
            } finally {
              setBusy('')
            }
          }}
        >
          {busy === p.id ? <Loader2 size={18} className="animate-spin" /> : providerIcon(p.id)}
          {busy === p.id ? 'Finish signing in in your browser…' : providerLabel(p.id, p.label)}
        </button>
      ))}
      <p className="text-[11px] text-ink-3 text-center leading-relaxed">Clutch only gets your name and picture. Recording and your local clips never need an account.</p>
    </div>
  )
}

export function SignInDialog() {
  const { signInReason, closeSignIn, account, goTo } = useStore()
  return (
    <Modal open={!!signInReason} onClose={closeSignIn} width="max-w-md" hideHeader>
      <div className="p-7 space-y-5">
        <div className="text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl grid place-items-center mb-3 text-accent border border-accent/40" style={{ background: 'radial-gradient(120% 120% at 30% 20%, rgba(38,187,255,0.3), rgba(38,187,255,0.05))' }}><Cloud size={26} /></div>
          <h3 className="text-xl font-semibold">Sign in to Clutch</h3>
          <p className="text-sm text-ink-2 mt-1.5 leading-relaxed">{signInReason}</p>
        </div>
        {account.serverUrl ? <ProviderButtons onDone={closeSignIn} /> : (
          <div className="space-y-4">
            <p className="text-sm text-ink-3 text-center leading-relaxed">Cloud sign-in isn't switched on in this copy of Clutch yet. Recording, clips, Discord and manual YouTube uploads all work without it.</p>
            <div className="flex gap-2">
              <button className="btn flex-1" onClick={closeSignIn}>Not now</button>
              <button className="btn-primary flex-1" onClick={() => goTo('settings', 'Cloud server')}>Open cloud settings</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export function ProDialog() {
  const { proOpen, setProOpen, account, signIn } = useStore()
  const toast = useToast()
  const isPro = account.plan?.id === 'pro'
  const upgrade = async () => {
    if (!account.signedIn) { setProOpen(false); signIn('Sign in first, then you can upgrade to Pro.'); return }
    try { await window.cf.account.checkout(); toast.push({ kind: 'info', title: 'Checkout opened in your browser', body: 'Your plan updates here as soon as payment goes through.' }) }
    catch (e) { toast.push({ kind: 'error', title: 'Could not start checkout', body: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': Error: /, '') }) }
  }
  return (
    <Modal open={proOpen} onClose={() => setProOpen(false)} width="max-w-2xl" hideHeader>
      <div className="p-7 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-hud text-[11px] tracking-[0.2em] text-warn"><Crown size={15} /> CLUTCH PRO</div>
            <h3 className="text-2xl font-semibold mt-1.5">More cloud, links that last, no sponsors.</h3>
            <p className="text-sm text-ink-2 mt-1">Everything that runs on your PC stays free forever. Pro pays for the cloud.</p>
          </div>
          <button className="btn-ghost h-9 w-9 px-0" onClick={() => setProOpen(false)} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="card-2 overflow-hidden">
          <div className="grid grid-cols-[1.6fr_1fr_1fr] text-sm">
            <div className="px-4 py-3 font-hud text-[10px] uppercase tracking-[0.16em] text-ink-3" />
            <div className="px-4 py-3 font-hud text-[10px] uppercase tracking-[0.16em] text-ink-3">Free</div>
            <div className="px-4 py-3 font-hud text-[10px] uppercase tracking-[0.16em] text-warn">Pro · $4.99/mo</div>
            {PLAN_ROWS.map((r) => (
              <div key={r.label} className="contents">
                <div className="px-4 py-2.5 border-t border-white/8 text-ink-2">{r.label}</div>
                <div className="px-4 py-2.5 border-t border-white/8">{r.free}</div>
                <div className="px-4 py-2.5 border-t border-white/8 text-ink font-medium flex items-center gap-1.5">{r.pro !== '—' && <Check size={13} className="text-ok" />}{r.pro}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-3">Cancel any time. Your clips on your PC are never affected.</p>
          {isPro ? (
            <button className="btn" onClick={() => void window.cf.account.portal()}>Manage subscription</button>
          ) : (
            <button className="btn-primary px-6" onClick={() => void upgrade()} disabled={!!account.signedIn && account.billing?.enabled === false} title={account.billing?.enabled === false ? 'Payments are not set up on this server yet' : ''}><Sparkles size={16} /> Upgrade to Pro</button>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Settings → Account: who you are, your plan, cloud usage, sponsored-card toggle, server. */
export function AccountSection() {
  const { account, settings, save, setProOpen } = useStore()
  const [server, setServer] = useState<string | null>(null)
  if (!settings) return null
  const used = account.usage?.bytes ?? 0
  const cap = account.plan?.storageBytes ?? 0
  const isPro = account.plan?.id === 'pro'
  return (
    <Section title="Account" icon={<UserRound size={16} />} desc="Only needed for cloud features: share links, cloud storage, auto-uploads and Pro. Recording works without it." right={isPro ? <Badge tone="warn"><Crown size={11} /> Pro</Badge> : account.signedIn ? <Badge>Free</Badge> : undefined}>
      {account.signedIn && account.user ? (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            {account.user.avatar ? <img src={account.user.avatar} alt="" className="w-12 h-12 rounded-full border border-white/20" referrerPolicy="no-referrer" /> : <span className="w-12 h-12 rounded-full grid place-items-center bg-white/10 text-lg font-semibold">{account.user.name.slice(0, 1).toUpperCase()}</span>}
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate">{account.user.name}</div>
              <div className="text-xs text-ink-3">Signed in with {({ google: 'Google', discord: 'Discord', twitch: 'Twitch', dev: 'test login' } as Record<string, string>)[account.user.provider] ?? account.user.provider}</div>
            </div>
            {isPro ? <button className="btn" onClick={() => void window.cf.account.portal()}>Manage subscription</button> : <button className="btn-primary" onClick={() => setProOpen(true)}><Crown size={15} /> Go Pro</button>}
            <button className="btn-ghost" onClick={() => void window.cf.account.signOut()}><LogOut size={15} /> Sign out</button>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1.5"><span className="label mb-0">Cloud storage</span><span className="text-ink-2 tabular">{fmtBytes(used)} of {Math.round(cap / 1024 ** 3)} GB</span></div>
            <Progress value={cap ? used / cap : 0} />
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <Toggle checked={isPro && settings.cloud.backupFavorites} onChange={(backupFavorites) => { if (!isPro) { setProOpen(true); return } void save({ cloud: { ...settings.cloud, backupFavorites } }) }} label="Back up favorites to the cloud" hint={isPro ? 'Every clip you heart is uploaded in the background.' : 'Included with Pro.'} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_320px] gap-6 items-start">
          <ul className="space-y-2.5 text-sm text-ink-2">
            {[
              [<Cloud size={15} key="c" />, 'Share links that play right in Discord and browsers'],
              [<Gamepad2 size={15} key="g" />, 'Cloud space for your best clips (2 GB free)'],
              [<Youtube size={15} key="y" />, 'Scheduled auto-uploads'],
              [<Crown size={15} key="p" />, 'Clutch Pro: 100 GB, links that never expire, no sponsors']
            ].map(([icon, text], i) => <li key={i} className="flex items-center gap-2.5"><span className="text-accent">{icon}</span>{text}</li>)}
          </ul>
          {account.serverUrl ? <ProviderButtons /> : <p className="text-sm text-ink-3">Cloud is not set up in this build yet. If you run your own Clutch server, enter it below.</p>}
        </div>
      )}
      {account.error && <p className="text-xs text-warn">{account.error}</p>}
      <div className="pt-3 border-t border-white/10 grid grid-cols-2 gap-6">
        <Toggle checked={settings.app.showAds && !account.plan?.features.adFree} onChange={(showAds) => void save({ app: { ...settings.app, showAds } })} label="Show sponsored cards" hint={account.plan?.features.adFree ? 'Never shown on Pro.' : 'One small card on Home and Clips, never in game. Keeping it on helps fund Clutch; turning it off is free.'} />
        <Field label="Cloud server" hint="Leave as-is for the official Clutch cloud, or point to your own server.">
          <div className="flex gap-2">
            <input className="input font-mono text-[12px]" placeholder="https://cloud.example.com" value={server ?? settings.cloud.serverUrl} onChange={(e) => setServer(e.target.value)} />
            <button className="btn shrink-0" disabled={server === null} onClick={() => { void save({ cloud: { ...settings.cloud, serverUrl: (server ?? '').trim() } }); setServer(null) }}>Save</button>
          </div>
        </Field>
      </div>
    </Section>
  )
}

/** One sponsored card. Hidden on Pro and when turned off; never shown in game. */
export function SponsoredCard({ placement }: { placement: 'home' | 'library' }) {
  const { settings, account, setProOpen, goTo } = useStore()
  const [ad, setAd] = useState<AdCard | null>(null)
  const enabled = !!settings?.app.showAds && !account.plan?.features.adFree
  useEffect(() => {
    if (!enabled) { setAd(null); return }
    void window.cf.ads.get(placement).then((a) => setAd(a[0] ?? null))
  }, [enabled, placement, account.signedIn])
  if (!enabled || !ad) return null
  return (
    <aside className="card p-4 flex items-center gap-4 fade-in" aria-label="Sponsored">
      <span className="relative z-[2] w-10 h-10 rounded-xl grid place-items-center shrink-0 text-warn border border-warn/35" style={{ background: 'radial-gradient(120% 120% at 30% 20%, rgba(255,200,87,0.25), rgba(255,200,87,0.04))' }}>{ad.url === 'clutch://pro' ? <Crown size={18} /> : <Sparkles size={18} />}</span>
      <div className="relative z-[2] min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate">{ad.title}</span>
          <span className="font-hud text-[9px] tracking-[0.16em] text-ink-3 border border-white/12 rounded-full px-1.5 py-px">SPONSORED</span>
        </div>
        <p className="text-xs text-ink-3 truncate">{ad.body}</p>
      </div>
      <button className="relative z-[2] btn-sm shrink-0" onClick={() => { if (ad.url === 'clutch://pro') { void window.cf.ads.open(ad); setProOpen(true) } else void window.cf.ads.open(ad) }}>{ad.cta}</button>
      <button className="relative z-[2] text-[11px] text-ink-3 hover:text-ink shrink-0" onClick={() => goTo('settings', 'Show sponsored cards')} title="Turn off sponsored cards (Settings → Account)">Hide</button>
    </aside>
  )
}
