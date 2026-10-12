import type { EditOptions } from '../shared/types'

/**
 * Pure FFmpeg filter builders for the editor (no Electron), so they can be tested with plain Node.
 */

export const OUT_SIZE: Record<Exclude<EditOptions['format'], 'original'>, { w: number; h: number }> = {
  vertical: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
  wide: { w: 1920, h: 1080 }
}

/** Filter-graph-safe path: forward slashes, escaped drive colon, quoted. */
export const filterPath = (p: string) => `'${p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")}'`
export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** atempo only takes 0.5..2 per instance, so chain them. */
export function atempo(speed: number): string {
  const parts: string[] = []
  let s = speed
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5 }
  while (s > 2) { parts.push('atempo=2'); s /= 2 }
  parts.push(`atempo=${s.toFixed(4)}`)
  return parts.join(',')
}

/** -filter_complex for one clip: reframe (crop or blurred fit), captions, speed. Outputs [v] and [a]. */
export function editFilter(o: EditOptions, src: { w: number; h: number }, srt: string | null, hasAudio: boolean): string {
  const W = src.w
  const H = src.h
  const speed = Math.min(4, Math.max(0.25, o.speed || 1))
  const vf: string[] = []
  let graph = ''
  if (o.format === 'original') {
    // Exports are H.264 for compatibility, and H.264 hardware encoders stop at 4096 px wide:
    // ultrawide sources are scaled to 3840 wide (4K), keeping the shape.
    const maxW = 3840
    vf.push(W > maxW ? `scale=${maxW}:${even((H * maxW) / W)}` : `scale=${even(W)}:${even(H)}`)
  } else {
    const out = OUT_SIZE[o.format]
    const target = out.w / out.h
    if (o.fit === 'blur') {
      graph = `[0:v]split=2[bgs][fgs];[bgs]scale=${out.w}:${out.h}:force_original_aspect_ratio=increase,crop=${out.w}:${out.h},gblur=sigma=40,eq=brightness=-0.08[bg];[fgs]scale=${out.w}:${out.h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`
    } else {
      // Largest crop of the target shape, positioned by the user's frame (cropX/cropY are 0..1).
      const cw = W / H > target ? even(H * target) : even(W)
      const ch = W / H > target ? even(H) : even(W / target)
      const x = Math.round((W - cw) * Math.min(1, Math.max(0, o.cropX ?? 0.5)))
      const y = Math.round((H - ch) * Math.min(1, Math.max(0, o.cropY ?? 0.5)))
      vf.push(`crop=${cw}:${ch}:${x}:${y}`, `scale=${out.w}:${out.h}`)
    }
  }
  if (srt) {
    const size = o.format === 'vertical' ? 13 : 18
    vf.push(`subtitles=filename=${filterPath(srt)}:force_style='FontName=Segoe UI,FontSize=${size},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=${o.format === 'vertical' ? 64 : 20}'`)
  }
  if (speed !== 1) vf.push(`setpts=PTS/${speed}`)
  vf.push('format=yuv420p')
  const chain = vf.join(',')
  const video = graph ? `${graph},${chain}[v]` : `[0:v]${chain}[v]`
  return hasAudio ? `${video};[0:a:0]${speed !== 1 ? atempo(speed) : 'anull'}[a]` : video
}

/** -filter_complex joining clips in order, scaled/padded to W x H at 60 fps. Outputs [v] and [a]. */
export function joinFilter(clips: { durationSec: number; hasAudio: boolean }[], W: number, H: number): string {
  const parts: string[] = []
  clips.forEach((c, i) => {
    parts.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=60,format=yuv420p[v${i}]`)
    parts.push(c.hasAudio
      ? `[${i}:a:0]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=0:${c.durationSec.toFixed(2)}[a${i}]`)
  })
  parts.push(`${clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${clips.length}:v=1:a=1[v][a]`)
  return parts.join(';')
}

/** Short filename suffix describing an edit, e.g. "vertical 0.5x captions". */
export function editSuffix(o: EditOptions, captions: boolean): string {
  const speed = Math.min(4, Math.max(0.25, o.speed || 1))
  return [o.format !== 'original' ? { vertical: 'vertical', square: 'square', wide: '16x9' }[o.format] : '', speed !== 1 ? `${speed}x` : '', captions ? 'captions' : ''].filter(Boolean).join(' ')
}
