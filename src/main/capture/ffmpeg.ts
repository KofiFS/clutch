import { app } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Encoder } from '../../shared/types'

/** Resolve the ffmpeg/ffprobe binaries: bundled copy first, then PATH. */
export function ffmpegPath(): string {
  const bundled = path.join(process.resourcesPath ?? '', 'ffmpeg', 'ffmpeg.exe')
  if (app.isPackaged && fs.existsSync(bundled)) return bundled
  const dev = path.join(app.getAppPath(), 'resources', 'ffmpeg', 'ffmpeg.exe')
  if (fs.existsSync(dev)) return dev
  return 'ffmpeg'
}

export function ffprobePath(): string {
  const p = ffmpegPath()
  return p === 'ffmpeg' ? 'ffprobe' : p.replace(/ffmpeg\.exe$/i, 'ffprobe.exe')
}

export function run(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 60_000 },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })
}

export interface EncoderInfo {
  available: Encoder[]
  /** Best working hardware encoder, or libx264. */
  best: Encoder
}

let cached: EncoderInfo | null = null

/** List encoders ffmpeg was built with, then test-encode a frame with each HW encoder to see which works on this GPU. */
export async function detectEncoders(): Promise<EncoderInfo> {
  if (cached) return cached
  const { stdout } = await run(ffmpegPath(), ['-hide_banner', '-encoders'])
  const candidates: Encoder[] = ['h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'h264_amf', 'h264_qsv', 'libx264']
  const built = candidates.filter((c) => stdout.includes(` ${c} `))
  const available: Encoder[] = []
  for (const enc of built) {
    if (enc === 'libx264') {
      available.push(enc)
      continue
    }
    const r = await run(
      ffmpegPath(),
      ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30', '-frames:v', '2', '-c:v', enc, '-f', 'null', '-'],
      { timeoutMs: 15_000 }
    )
    if (r.code === 0) available.push(enc)
  }
  const best = (['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264'] as Encoder[]).find((e) => available.includes(e)) ?? 'libx264'
  cached = { available, best }
  return cached
}

/** Enumerate DirectShow audio capture devices (microphones, virtual cables, Stereo Mix). */
export async function listAudioDevices(): Promise<string[]> {
  const { stderr } = await run(ffmpegPath(), ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { timeoutMs: 15_000 })
  const names: string[] = []
  for (const line of stderr.split(/\r?\n/)) {
    const m = line.match(/"([^"]+)"\s+\(audio\)/)
    if (m) names.push(m[1])
  }
  return names
}

export interface ProbeInfo {
  durationSec: number
  width: number
  height: number
  fps: number
}

export async function probe(file: string): Promise<ProbeInfo> {
  const { stdout } = await run(ffprobePath(), [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
    '-of', 'json', file
  ])
  try {
    const j = JSON.parse(stdout)
    const s = j.streams?.[0] ?? {}
    const [n, d] = String(s.r_frame_rate ?? '0/1').split('/').map(Number)
    return { durationSec: Number(j.format?.duration ?? 0), width: s.width ?? 0, height: s.height ?? 0, fps: d ? Math.round(n / d) : 0 }
  } catch {
    return { durationSec: 0, width: 0, height: 0, fps: 0 }
  }
}

export async function makeThumbnail(video: string, out: string, atSec = 1): Promise<void> {
  await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(atSec), '-i', video, '-frames:v', '1', '-vf', 'scale=480:-2', out])
}

/** Re-mux a time range of a clip into a new file (stream copy, cuts land on keyframes). */
export async function trimClip(src: string, out: string, startSec: number, endSec: number): Promise<boolean> {
  const r = await run(ffmpegPath(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', startSec.toFixed(2), '-to', endSec.toFixed(2), '-i', src,
    '-c', 'copy', '-movflags', '+faststart', out
  ], { timeoutMs: 120_000 })
  return r.code === 0
}
