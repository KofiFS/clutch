import { useEffect, useState } from 'react'
import { Captions, Loader2, Scissors, Wand2 } from 'lucide-react'
import type { Clip, EditOptions } from '../../../shared/types'
import { fmtTime, useStore } from '../lib/store'
import { useToast } from './Toasts'
import { Segmented, Toggle } from './ui'

export type EditState = Pick<EditOptions, 'format' | 'fit' | 'cropX' | 'cropY' | 'speed' | 'captions'>
export const DEFAULT_EDIT: EditState = { format: 'original', fit: 'crop', cropX: 0.5, cropY: 0.5, speed: 1, captions: false }

/** Target aspect ratio for a format (null = keep the clip's). */
export const formatAspect = (f: EditState['format']) => (f === 'vertical' ? 9 / 16 : f === 'square' ? 1 : f === 'wide' ? 16 / 9 : null)

/**
 * Edit tab of the clip viewer: vertical / square / 16:9 reframing (crop frame or blurred fit),
 * speed, and burned-in captions. Uses the trim range if one is set. Saves a new clip.
 */
export function EditPanel({ clip, edit, setEdit, trim }: { clip: Clip; edit: EditState; setEdit: (e: EditState) => void; trim: { start: number; end: number } | null }) {
  const { openClip } = useStore()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [modelReady, setModelReady] = useState<boolean | null>(null)
  useEffect(() => { void window.cf.editor.captionModelReady().then(setModelReady) }, [])
  useEffect(() => {
    const off = window.cf.on('editor-progress', (p: { clipId: string; stage: string; progress: number }) => {
      if (p.clipId === clip.id || p.clipId === '*model') { setBusy(p.stage); setProgress(p.progress) }
    })
    return () => { off() }
  }, [clip.id])

  const set = (patch: Partial<EditState>) => setEdit({ ...edit, ...patch })
  const range = trim ?? { start: 0, end: clip.durationSec }
  const outLen = (range.end - range.start) / edit.speed

  const run = async () => {
    setBusy('Starting'); setProgress(0)
    try {
      if (edit.captions && !modelReady) {
        setBusy('Downloading speech model')
        const ok = await window.cf.editor.downloadCaptionModel()
        setModelReady(ok)
        if (!ok) throw new Error('The speech model did not download')
      }
      const out = await window.cf.editor.export(clip.id, { ...edit, start: range.start, end: range.end })
      toast.push({ kind: 'success', title: 'Export saved', body: out.title, action: { label: 'Open', onClick: () => openClip(out.id) } })
    } catch (e) {
      toast.push({ kind: 'error', title: 'Export failed', body: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <span className="label">Format</span>
        <Segmented value={edit.format} onChange={(format) => set({ format })} ariaLabel="Format" options={[
          { value: 'original' as const, label: 'Original' },
          { value: 'vertical' as const, label: '9:16', title: 'Vertical: TikTok, Shorts, Reels' },
          { value: 'square' as const, label: '1:1', title: 'Square' },
          { value: 'wide' as const, label: '16:9', title: 'Widescreen' }
        ]} />
        {edit.format !== 'original' && (
          <div className="mt-3 space-y-2">
            <Segmented value={edit.fit} onChange={(fit) => set({ fit })} ariaLabel="Fit" options={[
              { value: 'crop' as const, label: 'Crop' },
              { value: 'blur' as const, label: 'Fit + blur' }
            ]} />
            <p className="text-xs text-ink-3">{edit.fit === 'crop' ? 'Drag the frame on the video to choose what stays in.' : 'The whole picture, with a blurred copy filling the rest.'}</p>
          </div>
        )}
      </div>

      <div>
        <span className="label">Speed</span>
        <Segmented value={edit.speed} onChange={(speed) => set({ speed })} ariaLabel="Speed" options={[0.25, 0.5, 1, 1.5, 2].map((s) => ({ value: s, label: `${s}x` }))} />
      </div>

      <div className="flex items-start gap-3">
        <Toggle checked={edit.captions} onChange={(captions) => set({ captions })} label="Add captions" hint={modelReady === false ? 'Turns speech into text on your PC. The first time, Clutch downloads a 57 MB speech model.' : 'Turns speech into text on your PC and burns it in.'} />
        <Captions size={16} className="text-ink-3 mt-1 ml-auto shrink-0" />
      </div>

      <div className="card-2 p-3 text-xs text-ink-2 flex items-center gap-2">
        <Scissors size={13} className="text-ink-3 shrink-0" />
        {trim ? `Trimmed: ${fmtTime(trim.start)} – ${fmtTime(trim.end)}` : 'Whole clip (use Trim below the video to export part of it)'}
        <span className="ml-auto tabular text-ink-3">{fmtTime(outLen)}</span>
      </div>

      <button className="btn-primary w-full h-11" disabled={!!busy || (edit.format === 'original' && edit.speed === 1 && !edit.captions)} onClick={() => void run()}>
        {busy ? <><Loader2 size={16} className="animate-spin" /> {busy}{progress > 0 ? ` ${Math.round(progress * 100)}%` : '…'}</> : <><Wand2 size={16} /> Export as a new clip</>}
      </button>
    </div>
  )
}

/**
 * Draggable crop frame drawn over the video (object-contain), for crop-mode formats.
 * Positions are reported as 0..1 within the free space, the same values the exporter uses.
 */
export function CropOverlay({ video, edit, setEdit }: { video: HTMLVideoElement | null; edit: EditState; setEdit: (e: EditState) => void }) {
  const [, force] = useState(0)
  useEffect(() => {
    if (!video) return
    const ro = new ResizeObserver(() => force((n) => n + 1))
    ro.observe(video)
    video.addEventListener('loadedmetadata', () => force((n) => n + 1))
    return () => ro.disconnect()
  }, [video])
  const aspect = formatAspect(edit.format)
  if (!video || !aspect || edit.fit !== 'crop' || !video.videoWidth) return null
  const vw = video.videoWidth
  const vh = video.videoHeight
  const box = video.getBoundingClientRect()
  const parent = video.parentElement!.getBoundingClientRect()
  const s = Math.min(box.width / vw, box.height / vh)
  const dw = vw * s
  const dh = vh * s
  const ox = box.left - parent.left + (box.width - dw) / 2
  const oy = box.top - parent.top + (box.height - dh) / 2
  const cw = vw / vh > aspect ? dh * aspect : dw
  const ch = vw / vh > aspect ? dh : dw / aspect
  const x = ox + (dw - cw) * (edit.cropX ?? 0.5)
  const y = oy + (dh - ch) * (edit.cropY ?? 0.5)

  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const start = { px: e.clientX, py: e.clientY, cx: edit.cropX ?? 0.5, cy: edit.cropY ?? 0.5 }
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const nx = dw - cw > 1 ? start.cx + (ev.clientX - start.px) / (dw - cw) : 0.5
      const ny = dh - ch > 1 ? start.cy + (ev.clientY - start.py) / (dh - ch) : 0.5
      setEdit({ ...edit, cropX: Math.min(1, Math.max(0, nx)), cropY: Math.min(1, Math.max(0, ny)) })
    }
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {/* Dim what gets cut away */}
      <div className="absolute bg-black/55" style={{ left: ox, top: oy, width: Math.max(0, x - ox), height: dh }} />
      <div className="absolute bg-black/55" style={{ left: x + cw, top: oy, width: Math.max(0, ox + dw - x - cw), height: dh }} />
      <div className="absolute bg-black/55" style={{ left: x, top: oy, width: cw, height: Math.max(0, y - oy) }} />
      <div className="absolute bg-black/55" style={{ left: x, top: y + ch, width: cw, height: Math.max(0, oy + dh - y - ch) }} />
      <div
        role="slider"
        aria-label="Crop position"
        aria-valuenow={Math.round((edit.cropX ?? 0.5) * 100)}
        tabIndex={0}
        onPointerDown={onDown}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="absolute border-2 border-white rounded-md cursor-grab active:cursor-grabbing pointer-events-auto"
        style={{ left: x, top: y, width: cw, height: ch }}
      />
    </div>
  )
}
