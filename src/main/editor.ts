import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import type { Clip, EditOptions } from '../shared/types'
import { detectEncoders, ffmpegPath, ffprobePath, lowerPriority, probe, run } from './capture/ffmpeg'
import { editFilter, editSuffix, even, filterPath, joinFilter } from './editorArgs'

/**
 * Re-encoding edits that Medal users ask for: crop and vertical (9:16) / square exports, with a
 * crop frame or a blurred-background fit, speed changes, burned-in auto captions, and joining
 * clips. Everything runs on the PC. Exports are new files; the original clip is never changed.
 */

/** Video encoder for exports: NVIDIA/AMD/Intel H.264 when present (fast), otherwise x264. */
async function h264Args(): Promise<string[]> {
  const enc = await detectEncoders()
  if (enc.available.includes('h264_nvenc')) return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '21', '-b:v', '0', '-pix_fmt', 'yuv420p']
  if (enc.available.includes('h264_amf')) return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '22', '-pix_fmt', 'yuv420p']
  if (enc.available.includes('h264_qsv')) return ['-c:v', 'h264_qsv', '-global_quality', '22', '-pix_fmt', 'nv12']
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p']
}

async function hasAudio(file: string): Promise<boolean> {
  const r = await run(ffprobePath(), ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file])
  return r.stdout.trim().length > 0
}

// ---------------------------------------------------------------- captions (whisper.cpp in FFmpeg)

const MODEL_NAME = 'ggml-base-q5_1.bin'
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`
const MODEL_MIN_BYTES = 40 * 1024 * 1024
export const captionModelPath = () => path.join(app.getPath('userData'), 'models', MODEL_NAME)
export const captionModelReady = () => { try { return fs.statSync(captionModelPath()).size > MODEL_MIN_BYTES } catch { return false } }

/** Download the speech model once (~57 MB, multilingual). Only when someone turns captions on. */
export function downloadCaptionModel(onProgress?: (f: number) => void): Promise<void> {
  const dest = captionModelPath()
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.part`
  const get = (url: string, hops = 0): Promise<void> => new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Clutch' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
        res.resume()
        return void get(new URL(res.headers.location, url).toString(), hops + 1).then(resolve, reject)
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Model download failed (${res.statusCode})`)) }
      const total = Number(res.headers['content-length'] ?? 0)
      let got = 0
      const out = fs.createWriteStream(tmp)
      res.on('data', (c: Buffer) => { got += c.length; if (total) onProgress?.(got / total) })
      res.pipe(out)
      out.on('finish', () => out.close(() => {
        if (got < MODEL_MIN_BYTES) return reject(new Error('Model download was incomplete'))
        fs.renameSync(tmp, dest)
        resolve()
      }))
      out.on('error', reject)
    }).on('error', reject)
  })
  return get(MODEL_URL)
}

/** Speech -> SRT for [start, end] of a clip, on the original timeline starting at 0. */
async function transcribe(src: string, start: number, end: number, srt: string): Promise<boolean> {
  if (!captionModelReady()) throw new Error('The caption model is not downloaded yet')
  try { fs.unlinkSync(srt) } catch { /* none */ }
  const af = `aresample=16000,whisper=model=${filterPath(captionModelPath())}:language=auto:queue=8:max_len=42:destination=${filterPath(srt)}:format=srt`
  const r = await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', start.toFixed(2), '-to', end.toFixed(2), '-i', src, '-map', '0:a:0', '-af', af, '-f', 'null', '-'], { timeoutMs: 10 * 60_000 })
  if (r.code !== 0) throw new Error(`Captions failed: ${r.stderr.trim().split('\n').pop()}`)
  return fs.existsSync(srt) && fs.statSync(srt).size > 0
}

// ---------------------------------------------------------------- export

export interface ExportResult { file: string; title: string }

/** Crop / reframe, speed and captions for one clip (optionally a trimmed range). */
export async function exportEdit(clip: Clip, o: EditOptions, onProgress?: (stage: string, f: number) => void, outDir = path.dirname(clip.file)): Promise<ExportResult> {
  const info = await probe(clip.file)
  const start = Math.max(0, o.start ?? 0)
  const end = Math.min(info.durationSec || clip.durationSec, o.end ?? (info.durationSec || clip.durationSec))
  if (end - start < 0.5) throw new Error('The selection is too short')
  const speed = Math.min(4, Math.max(0.25, o.speed || 1))
  const tmpDir = path.join(app.getPath('userData'), 'tmp')
  fs.mkdirSync(tmpDir, { recursive: true })

  let srt: string | null = null
  if (o.captions) {
    onProgress?.('Writing captions', 0)
    srt = path.join(tmpDir, `captions-${clip.id}.srt`)
    if (!(await transcribe(clip.file, start, end, srt))) srt = null
  }

  const audio = await hasAudio(clip.file)
  const filter = editFilter({ ...o, speed }, { w: info.width || clip.width, h: info.height || clip.height }, srt, audio)
  const suffix = editSuffix({ ...o, speed }, !!srt)
  // Never the clip's own path, whatever its extension.
  const base = path.join(outDir, path.basename(clip.file).replace(/\.[^.]+$/, ''))
  let outFile = `${base} ${suffix || 'edit'}.mp4`
  for (let i = 2; fs.existsSync(outFile); i++) outFile = `${base} ${suffix || 'edit'} ${i}.mp4`

  onProgress?.('Exporting', 0)
  const durOut = (end - start) / speed
  const args = ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-ss', start.toFixed(2), '-to', end.toFixed(2), '-i', clip.file,
    '-filter_complex', filter, '-map', '[v]', ...(audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []),
    ...(await h264Args()), '-movflags', '+faststart', outFile]
  await runWithProgress(args, durOut, (f) => onProgress?.('Exporting', f))
  if (srt) { try { fs.unlinkSync(srt) } catch { /* ignore */ } }
  const title = `${clip.title}${suffix ? ` (${suffix})` : ''}`
  return { file: outFile, title }
}

/** A plain H.264 MP4 copy that plays everywhere (for clips stored as AV1/HEVC), saved where the user chose. */
export async function exportCompatible(clip: Clip, outFile: string, onProgress?: (f: number) => void): Promise<void> {
  const info = await probe(clip.file)
  const audio = await hasAudio(clip.file)
  const filter = editFilter({ format: 'original', fit: 'crop', speed: 1, captions: false }, { w: info.width || clip.width, h: info.height || clip.height }, null, audio)
  await runWithProgress(['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', clip.file, '-filter_complex', filter, '-map', '[v]', ...(audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []), ...(await h264Args()), '-movflags', '+faststart', outFile], info.durationSec || clip.durationSec, onProgress)
}

/** Join clips in order into one video (scaled to the first clip's size, 60 fps). */
export async function joinClips(clips: Clip[], onProgress?: (f: number) => void, outDir?: string): Promise<ExportResult> {
  if (clips.length < 2) throw new Error('Pick at least two clips')
  const first = await probe(clips[0].file)
  const W = even(Math.min(first.width || 1920, 2560))
  const H = even((first.height || 1080) * (W / (first.width || 1920)))
  const inputs: string[] = []
  const meta: { durationSec: number; hasAudio: boolean }[] = []
  let total = 0
  for (const c of clips) {
    inputs.push('-i', c.file)
    total += c.durationSec
    meta.push({ durationSec: c.durationSec, hasAudio: await hasAudio(c.file) })
  }
  const filter = joinFilter(meta, W, H)
  const dir = outDir ?? path.dirname(clips[0].file)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outFile = path.join(dir, `Joined ${stamp}.mp4`)
  const args = ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', ...inputs, '-filter_complex', filter, '-map', '[v]', '-map', '[a]', ...(await h264Args()), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outFile]
  await runWithProgress(args, total, onProgress)
  return { file: outFile, title: `${clips[0].title} + ${clips.length - 1} more` }
}

/** Run FFmpeg below normal priority, reporting progress from `-progress pipe:1`. */
function runWithProgress(args: string[], durationSec: number, onProgress?: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), args, { windowsHide: true })
    lowerPriority(p.pid)
    let err = ''
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (s: string) => {
      const m = s.match(/out_time_us=(\d+)/g)
      if (m && durationSec > 0) onProgress?.(Math.min(1, Number(m[m.length - 1].split('=')[1]) / 1e6 / durationSec))
    })
    p.stderr.on('data', (d) => { err = (err + d).slice(-3000) })
    p.on('error', reject)
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Export failed: ${err.trim().split('\n').filter(Boolean).pop() ?? code}`)))
  })
}
