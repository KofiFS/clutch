import fs from 'node:fs'
import type { BufferStatus, HealthItem, Settings } from '../shared/types'
import { detectEncoders, ffmpegPath, listAudioDevices, run } from './capture/ffmpeg'

let ffmpegInfo: { ok: boolean; version: string; ddagrab: boolean } | null = null

async function checkFfmpeg() {
  if (ffmpegInfo) return ffmpegInfo
  const v = await run(ffmpegPath(), ['-version'], { timeoutMs: 10_000 })
  const version = v.stdout.match(/ffmpeg version (\S+)/)?.[1] ?? ''
  const f = await run(ffmpegPath(), ['-hide_banner', '-filters'], { timeoutMs: 10_000 })
  ffmpegInfo = { ok: v.code === 0, version, ddagrab: / ddagrab /.test(f.stdout) }
  return ffmpegInfo
}

/** Everything that has to be right for recording to work, in plain language with a place to fix it. */
export async function healthCheck(settings: Settings, status: BufferStatus): Promise<HealthItem[]> {
  const items: HealthItem[] = []
  const ff = await checkFfmpeg()
  items.push({
    id: 'ffmpeg',
    label: 'FFmpeg',
    ok: ff.ok && ff.ddagrab,
    detail: !ff.ok ? 'ffmpeg.exe was not found on PATH or in resources/ffmpeg.' : !ff.ddagrab ? `FFmpeg ${ff.version} has no ddagrab screen capture. Install a "full" build.` : `FFmpeg ${ff.version} with desktop duplication.`
  })
  const enc = await detectEncoders()
  items.push({
    id: 'encoder',
    label: 'Hardware encoder',
    ok: enc.best === 'libx264' ? 'warn' : true,
    detail: enc.best === 'libx264' ? 'No GPU encoder found; recording will use the CPU (x264).' : `Using ${enc.best}. Available: ${enc.available.join(', ')}.`,
    fix: 'settings'
  })
  const devices = await listAudioDevices()
  const mic = settings.capture.micDevice
  items.push({
    id: 'mic',
    label: 'Microphone',
    ok: !mic ? 'warn' : devices.includes(mic),
    detail: !mic ? 'No microphone selected. Your voice will not be recorded.' : devices.includes(mic) ? mic : `"${mic}" is not plugged in. Pick another device.`,
    fix: 'settings'
  })
  items.push({
    id: 'system-audio',
    label: 'Game & voice-chat audio',
    ok: !settings.capture.systemAudio ? 'warn' : status.running ? !!status.systemAudioActive : true,
    detail: !settings.capture.systemAudio ? 'System audio is off. Friends in voice chat will not be heard in clips.' : status.running && !status.systemAudioActive ? 'No audio is arriving from Windows loopback.' : 'Captured through Windows loopback.',
    fix: 'settings'
  })
  items.push({
    id: 'hotkey',
    label: `Clip hotkey (${settings.capture.clipHotkey || 'none'})`,
    ok: !settings.capture.clipHotkey ? 'warn' : status.hotkeyRegistered !== false,
    detail: !settings.capture.clipHotkey ? 'No hotkey set.' : status.hotkeyRegistered === false ? 'Another app (Medal?) already uses this key. Choose a different one.' : 'Registered and ready.',
    fix: 'settings'
  })
  const dir = settings.capture.outputDir
  let free = ''
  try {
    fs.mkdirSync(dir, { recursive: true })
    const st = fs.statfsSync(dir)
    free = `${Math.round((st.bavail * st.bsize) / 1e9)} GB free`
  } catch {
    free = ''
  }
  items.push({ id: 'disk', label: 'Clip folder', ok: !!free, detail: free ? `${dir} - ${free}` : `Cannot write to ${dir}.`, fix: 'settings' })
  items.push({
    id: 'ai',
    label: 'AI moment detection',
    ok: settings.vision.enabled ? !!(settings.ai.anthropicApiKey || process.env.ANTHROPIC_API_KEY) : 'warn',
    detail: !settings.vision.enabled ? 'Off. Turn it on under "What to clip" to auto-clip kills and goals.' : settings.ai.anthropicApiKey || process.env.ANTHROPIC_API_KEY ? `On, checking every ${settings.vision.intervalSeconds}s with ${settings.ai.model}.` : 'Enabled but no API key. Add one under Settings → AI.',
    fix: settings.vision.enabled ? 'settings' : 'rules'
  })
  items.push({
    id: 'youtube',
    label: 'YouTube',
    ok: settings.upload.youtube.connected ? true : 'warn',
    detail: settings.upload.youtube.connected ? `Connected as ${settings.upload.youtube.channelTitle}.` : 'Not connected. Connect to upload clips.',
    fix: 'uploads'
  })
  return items
}
