import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { VoiceCommandAction, VoiceCommandSettings } from '../../shared/types'
import { ffmpegPath } from './ffmpeg'

const POWERSHELL = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const helperScript = () => path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources', 'voice-commands.ps1')
/** The same command can't fire twice in a row this fast (echoes, "clip that, clip that!"). */
const REPEAT_MS = 2500

export interface HeardEvent {
  text: string
  confidence: number
  /** Set when the text is one of the command phrases and confident enough to run. */
  action?: VoiceCommandAction
  /** A command phrase that was below the confidence bar. */
  ignored?: boolean
}

/**
 * Spoken commands ("clip that") with Windows' offline speech recognizer: FFmpeg reads the chosen
 * mic as 16 kHz mono PCM and pipes it into resources/voice-commands.ps1, which listens for the
 * command phrases next to a general dictation grammar (so ordinary talk doesn't trigger them).
 * Nothing leaves the PC. Runs only while Clutch is recording (or during a short test).
 */
export class VoiceCommands extends EventEmitter<{ command: [{ action: VoiceCommandAction; phrase: string; confidence: number }]; heard: [HeardEvent]; error: [string] }> {
  private mic: ChildProcess | null = null
  private helper: ChildProcess | null = null
  private sig = ''
  private last = new Map<VoiceCommandAction, number>()
  private testing = false
  /** Why voice commands can't run on this PC, once known (no speech recognizer, no mic). */
  unavailable: string | null = null

  get running() {
    return !!this.helper
  }

  /** Start (or restart with new phrases / mic). No-op when already listening with the same setup. */
  start(rules: VoiceCommandSettings, micDevice: string | undefined, opts: { test?: boolean } = {}) {
    const phrases = rules.commands.map((c) => c.phrase.trim().toLowerCase()).filter(Boolean)
    if (!micDevice) { this.stop(); this.unavailable = 'Pick a microphone first.'; return }
    if (!phrases.length) { this.stop(); return }
    const sig = JSON.stringify([phrases, micDevice, !!opts.test])
    if (this.helper && sig === this.sig) return
    this.stop()
    this.sig = sig
    this.testing = !!opts.test
    this.unavailable = null

    const b64 = Buffer.from(JSON.stringify([...new Set(phrases)]), 'utf8').toString('base64')
    const helper = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperScript(), '-PhrasesB64', b64, ...(opts.test ? ['-ShowAll'] : [])], { windowsHide: true })
    const mic = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-f', 'dshow', '-audio_buffer_size', '50', '-i', `audio=${micDevice}`, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { windowsHide: true })
    this.helper = helper
    this.mic = mic
    mic.stdout!.pipe(helper.stdin!)
    helper.stdin!.on('error', () => undefined) // helper gone: the pipe breaks quietly
    let micErr = ''
    mic.stderr!.on('data', (d) => { micErr = (micErr + d).slice(-400) })
    mic.on('exit', (code) => {
      if (this.mic !== mic) return
      this.mic = null
      if (code && this.helper === helper) this.emit('error', `Couldn't open the microphone for voice commands${micErr ? `: ${micErr.trim().split('\n').pop()}` : ''}`)
      this.stop()
    })

    let buf = ''
    helper.stdout!.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '')
        buf = buf.slice(i + 1)
        this.onLine(line, rules)
      }
    })
    helper.on('exit', () => {
      if (this.helper !== helper) return
      this.helper = null
      this.stop()
    })
  }

  stop() {
    const { mic, helper } = this
    this.mic = null
    this.helper = null
    this.sig = ''
    try { mic?.kill() } catch { /* gone */ }
    try { helper?.stdin?.end() } catch { /* gone */ }
    try { helper?.kill() } catch { /* gone */ }
  }

  private onLine(line: string, rules: VoiceCommandSettings) {
    if (line.startsWith('ERROR')) {
      const msg = line.slice(6).trim()
      if (/recognizer/i.test(msg)) this.unavailable = 'Windows has no English speech recognizer on this PC. Add one under Settings → Time & language → Speech.'
      this.emit('error', msg)
      return
    }
    const [kind, text, conf] = line.split('\t')
    if (kind !== 'CMD' && kind !== 'HEARD') return
    const confidence = Number(conf) || 0
    const phrase = (text ?? '').trim().toLowerCase()
    const cmd = kind === 'CMD' ? rules.commands.find((c) => c.phrase.trim().toLowerCase() === phrase) : undefined
    if (!cmd) { if (this.testing) this.emit('heard', { text: text ?? '', confidence }); return }
    if (confidence < rules.minConfidence) { this.emit('heard', { text: text ?? '', confidence, ignored: true }); return }
    this.emit('heard', { text: text ?? '', confidence, action: cmd.action })
    if (this.testing) return // a test only shows what was heard
    const now = Date.now()
    if (now - (this.last.get(cmd.action) ?? 0) < REPEAT_MS) return
    this.last.set(cmd.action, now)
    this.emit('command', { action: cmd.action, phrase: cmd.phrase, confidence })
  }
}
