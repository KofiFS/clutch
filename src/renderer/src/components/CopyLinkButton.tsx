import { useEffect, useState } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import type { Clip } from '../../../shared/types'
import { useStore } from '../lib/store'
import { useToast } from './Toasts'

/**
 * The default way to share: one click uploads the clip (if it isn't already), makes a link that
 * plays right inside Discord and browsers, and copies it.
 */
export function CopyLinkButton({ clip, variant = 'icon' }: { clip: Clip; variant?: 'icon' | 'button' }) {
  const { account, signIn } = useStore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    if (!busy) return
    const off = window.cf.on('cloud-progress', (p: { clipId: string; progress: number }) => { if (p.clipId === clip.id) setProgress(p.progress) })
    return () => { off() }
  }, [busy, clip.id])

  const copy = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (busy) return
    if (!account.signedIn) { signIn('Sign in (free) to get links that play right in Discord and browsers.'); return }
    const existing = clip.cloud && (!clip.cloud.expires || clip.cloud.expires > Date.now()) ? clip.cloud.shareUrl : null
    setBusy(!existing); setProgress(0)
    try {
      const url = existing ?? (await window.cf.cloud.share(clip.id)).shareUrl
      await navigator.clipboard.writeText(url)
      toast.push({ kind: 'success', title: 'Link copied', body: 'Paste it in Discord or anywhere. It plays right there.' })
    } catch (err) {
      toast.push({ kind: 'error', title: 'Could not make the link', body: String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally {
      setBusy(false)
    }
  }

  const label = busy ? (progress > 0 ? `Uploading ${Math.round(progress * 100)}%` : 'Preparing…') : 'Copy link'
  if (variant === 'button') {
    return <button className="btn-primary h-9 px-4" onClick={(e) => void copy(e)} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} {label}</button>
  }
  return (
    <button onClick={(e) => void copy(e)} disabled={busy} className="w-7 h-7 -mt-1 rounded-md grid place-items-center text-ink-3 hover:text-ink hover:bg-surface-3" aria-label="Copy share link" title={busy ? label : 'Copy share link'}>
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={15} />}
    </button>
  )
}
