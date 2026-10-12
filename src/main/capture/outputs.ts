import { screen } from 'electron'
import { ffmpegPath, run } from './ffmpeg'

/**
 * ddagrab numbers monitors in DXGI order, which doesn't have to match Electron's display list.
 * Probe each DXGI output's size once and match displays by size (order breaks ties).
 */
let outputs: { idx: number; w: number; h: number }[] | null = null

let watching = false

async function probeOutputs(): Promise<{ idx: number; w: number; h: number }[]> {
  // Forget probed outputs when monitors change. Registered on first use: the screen module only
  // works after the app is ready, and this file is loaded before that.
  if (!watching) {
    watching = true
    const reset = () => { outputs = null }
    screen.on('display-added', reset)
    screen.on('display-removed', reset)
    screen.on('display-metrics-changed', reset)
  }
  if (outputs) return outputs
  const found: { idx: number; w: number; h: number }[] = []
  for (let idx = 0; idx < 8; idx++) {
    const r = await run(ffmpegPath(), ['-hide_banner', '-f', 'lavfi', '-i', `ddagrab=output_idx=${idx}:framerate=1`, '-frames:v', '1', '-f', 'null', '-'], { timeoutMs: 8000 })
    const m = r.stderr.match(/Video: [^\n]*?(\d{3,5})x(\d{3,5})/)
    if (r.code !== 0 || !m) break
    found.push({ idx, w: Number(m[1]), h: Number(m[2]) })
  }
  outputs = found
  return found
}

/** DXGI output index for an Electron display, or undefined to keep the monitor setting. */
export async function outputIndexFor(display: Electron.Display): Promise<number | undefined> {
  const list = await probeOutputs().catch(() => [])
  if (!list.length) return undefined
  const w = Math.round(display.size.width * display.scaleFactor)
  const h = Math.round(display.size.height * display.scaleFactor)
  const same = list.filter((o) => o.w === w && o.h === h)
  if (same.length === 1) return same[0].idx
  if (!same.length) return undefined
  // Several monitors with the same size: assume both lists keep the same relative order.
  const sameDisplays = screen.getAllDisplays().filter((d) => Math.round(d.size.width * d.scaleFactor) === w && Math.round(d.size.height * d.scaleFactor) === h)
  const pos = sameDisplays.findIndex((d) => d.id === display.id)
  return same[Math.max(0, pos)]?.idx
}

