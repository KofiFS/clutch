import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'

const RATE = 48000
const BYTES_PER_SEC = RATE * 2 * 2
const POWERSHELL = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const helperScript = () => path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources', 'app-audio.ps1')

/** Root process of an app (e.g. the Discord.exe whose parent isn't Discord.exe), by exe name. */
export function findAppRootPid(processName: string): Promise<number | null> {
  const exe = `${processName.replace(/\.exe$/i, '')}.exe`
  const script = `Get-CimInstance Win32_Process -Filter "Name='${exe.replace(/'/g, "''")}'" | ForEach-Object { "{0} {1}" -f $_.ProcessId, $_.ParentProcessId }`
  return new Promise((resolve) => {
    execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10_000 }, (_e, stdout) => {
      const rows = String(stdout).trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/).map(Number)).filter((r) => r.length === 2 && r[0] > 0)
      if (!rows.length) return resolve(null)
      const pids = new Set(rows.map((r) => r[0]))
      // The root of the tree captures every child process too (Discord plays voice from a child).
      resolve((rows.find((r) => !pids.has(r[1])) ?? rows[0])[0])
    })
  })
}

/**
 * One app's audio for its own track (Discord without a virtual cable). Windows' per-process
 * loopback (app-audio.ps1) captures the app and its children; this class serves the PCM to
 * FFmpeg over a named pipe at exactly real time, writing silence while the app is quiet, closed
 * or not started yet. Steady 20 ms writes matter: bursty audio inputs stall FFmpeg's video.
 */
export class AppAudioSource {
  readonly pipePath: string
  private server: net.Server
  private socket: net.Socket | null = null
  private helper: ChildProcess | null = null
  private queue: Buffer[] = []
  private pump: NodeJS.Timeout | null = null
  private watch: NodeJS.Timeout | null = null
  private written = 0
  private startedAt = 0
  private stopped = false
  private lastPcmAt = 0
  private lastDb = -100
  /** Current level for meters (silence when nothing arrived lately). */
  get levelDb() {
    return Date.now() - this.lastPcmAt < 400 ? this.lastDb : -100
  }
  /** Last problem, shown in the activity log once. */
  onLog: (msg: string) => void = () => {}

  constructor(readonly id: string, readonly processName: string) {
    this.pipePath = `\\\\.\\pipe\\clutch-app-${id.replace(/[^\w-]/g, '')}-${process.pid}-${Date.now()}`
    this.server = net.createServer((sock) => {
      this.socket = sock
      sock.on('error', () => undefined)
      this.startedAt = Date.now()
      this.written = 0
      this.pump = setInterval(() => this.tick(), 20)
    })
    this.server.on('error', (e) => this.onLog(`App audio pipe error: ${e.message}`))
  }

  /** Listen before FFmpeg starts (it opens the pipe as an input file right away). */
  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.pipePath, () => { this.server.off('error', reject); resolve() })
    })
  }

  start() {
    void this.attach()
    // App closed or not open yet: look for it again every 10 s.
    this.watch = setInterval(() => { if (!this.helper) void this.attach() }, 10_000)
  }

  private async attach() {
    if (this.stopped || this.helper) return
    const pid = await findAppRootPid(this.processName)
    if (!pid || this.stopped || this.helper) return
    const h = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass', '-File', helperScript(), String(pid), 'include'], { windowsHide: true })
    this.helper = h
    let err = ''
    h.stdout!.on('data', (b: Buffer) => this.onPcm(b))
    h.stderr!.on('data', (d) => { err = (err + d).slice(-500) })
    h.on('exit', (code) => {
      if (this.helper === h) this.helper = null
      if (code && code > 1 && !this.stopped) this.onLog(`Could not capture ${this.processName} audio (${err.trim().split('\n').pop() || code}). Needs Windows 10 2004 or newer.`)
    })
  }

  private onPcm(b: Buffer) {
    this.queue.push(b)
    // Level for meters: RMS of this chunk.
    let sum = 0
    const n = Math.floor(b.length / 2)
    for (let i = 0; i < n; i += 8) { const v = b.readInt16LE(i * 2) / 32768; sum += v * v }
    const rms = Math.sqrt(sum / Math.max(1, n / 8))
    this.lastDb = rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100
    this.lastPcmAt = Date.now()
  }

  private tick() {
    const s = this.socket
    if (!s || s.destroyed) return
    const target = Math.floor(((Date.now() - this.startedAt) / 1000) * BYTES_PER_SEC) & ~3
    let need = target - this.written
    while (need > 0 && this.queue.length) {
      const chunk = this.queue.shift()!
      s.write(chunk)
      this.written += chunk.length
      need -= chunk.length
    }
    if (need > 0) {
      const z = need & ~3
      s.write(Buffer.alloc(z))
      this.written += z
    }
    // Never more than ~0.3 s behind live.
    let queued = this.queue.reduce((t, x) => t + x.length, 0)
    while (queued > BYTES_PER_SEC * 0.3 && this.queue.length) queued -= this.queue.shift()!.length
  }

  stop() {
    this.stopped = true
    if (this.pump) clearInterval(this.pump)
    if (this.watch) clearInterval(this.watch)
    this.helper?.kill()
    this.helper = null
    this.socket?.destroy()
    this.server.close()
  }
}
