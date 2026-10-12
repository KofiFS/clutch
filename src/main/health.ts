import fs from 'node:fs'
import path from 'node:path'
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
    fix: 'settings', fixFind: 'Quality'
  })
  const devices = await listAudioDevices()
  const mics = (settings.capture.audioSources ?? []).filter((x) => x.kind === 'mic' && x.enabled && x.device)
  const missing = mics.filter((x) => !devices.includes(x.device!))
  items.push({
    id: 'mic',
    label: mics.length > 1 ? `Microphones (${mics.length})` : 'Microphone',
    ok: !mics.length ? 'warn' : missing.length ? false : true,
    detail: !mics.length ? 'No microphone selected. Your voice will not be recorded.' : missing.length ? `${missing.map((m) => `"${m.device}"`).join(', ')} not plugged in.` : mics.map((m) => m.device).join(', '),
    fix: 'settings', fixFind: 'Audio sources'
  })
  items.push({
    id: 'system-audio',
    label: 'Game & voice-chat audio',
    ok: !settings.capture.systemAudio ? 'warn' : status.running ? !!status.systemAudioActive : true,
    detail: !settings.capture.systemAudio ? 'System audio is off. Friends in voice chat will not be heard in clips.' : status.running && !status.systemAudioActive ? 'No audio is arriving from Windows loopback.' : 'Captured through Windows loopback.',
    fix: 'settings', fixFind: 'Audio sources'
  })
  items.push({
    id: 'hotkey',
    label: `Clip hotkey (${settings.capture.clipHotkey || 'none'})`,
    ok: !settings.capture.clipHotkey ? 'warn' : status.hotkeyRegistered !== false,
    detail: !settings.capture.clipHotkey ? 'No hotkey set.' : status.hotkeyRegistered === false ? 'Another app (Medal?) already uses this key. Choose a different one.' : 'Registered and ready.',
    fix: 'settings', fixFind: 'Clip hotkey'
  })
  const dir = settings.capture.outputDir
  let free = ''
  let freeGB = 0
  try {
    fs.mkdirSync(dir, { recursive: true })
    const st = fs.statfsSync(dir)
    freeGB = (st.bavail * st.bsize) / 1024 ** 3
    free = `${Math.round(freeGB)} GB free`
  } catch {
    free = ''
    freeGB = 0
  }
  const low = free && freeGB < (settings.storage?.lowSpaceGB ?? 10)
  items.push({ id: 'disk', label: 'Clip folder', ok: !free ? false : low ? 'warn' : true, detail: !free ? `Cannot write to ${dir}.` : low ? `${dir} - only ${free}. Set a storage limit under Settings → Storage.` : `${dir} - ${free}`, fix: 'settings', fixFind: 'Storage' })
  items.push({
    id: 'ai',
    label: 'AI moment detection',
    ok: settings.vision.enabled ? !!(settings.ai.anthropicApiKey || process.env.ANTHROPIC_API_KEY || status.vision) : 'warn',
    detail: !settings.vision.enabled
      ? 'Off. Turn it on under "What to clip" to auto-clip kills and goals.'
      : settings.ai.anthropicApiKey || process.env.ANTHROPIC_API_KEY
        ? `On with your key (${settings.vision.model}), only at moments flagged on your PC, at most ${settings.vision.maxPerMinute}/min.`
        : status.vision ? 'On through your Clutch account (daily checks).' : 'On, but it needs a Clutch account or an Anthropic API key.',
    fix: settings.vision.enabled ? 'settings' : 'rules', fixFind: settings.vision.enabled ? 'AI' : 'Watch the screen for moments'
  })
  // Medal grabs F8 for its clip key; two apps can't share a global hotkey.
  const medalInstalled = fs.existsSync(path.join(process.env.LOCALAPPDATA ?? '', 'Medal'))
  if (medalInstalled && settings.capture.clipHotkey.trim().toUpperCase() === 'F8') {
    items.push({ id: 'medal', label: 'Hotkey shared with Medal', ok: 'warn', detail: 'Medal also uses F8 to clip. Close Medal, or pick another key (F9 is free) under Settings → Hotkey.', fix: 'settings', fixFind: 'Clip hotkey' })
  }
  items.push({
    id: 'youtube',
    label: 'YouTube',
    ok: settings.upload.youtube.connected ? true : 'warn',
    detail: settings.upload.youtube.connected ? `Connected as ${settings.upload.youtube.channelTitle}.` : 'Not connected. Connect to upload clips.',
    fix: 'settings', fixFind: 'Accounts'
  })
  return items
}
