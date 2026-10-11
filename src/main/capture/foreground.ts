import { app, nativeImage } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { GameInfo } from '../../shared/types'

const LINE_BREAK = /\r?\n/

// Foreground window: process name, title, exe path, and whether it covers the whole monitor.
const PS_FOREGROUND = [
  'Add-Type @"',
  'using System; using System.Runtime.InteropServices;',
  'public struct RECT { public int L; public int T; public int R; public int B; }',
  'public class FG {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);',
  '  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);',
  '  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);',
  '  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);',
  '}',
  '"@',
  '$h=[FG]::GetForegroundWindow(); $procId=0; [FG]::GetWindowThreadProcessId($h,[ref]$procId) | Out-Null',
  '$r=New-Object RECT; [FG]::GetWindowRect($h,[ref]$r) | Out-Null',
  '$sw=[FG]::GetSystemMetrics(0); $sh=[FG]::GetSystemMetrics(1)',
  // Fullscreen = covers the screen AND has no title bar. Maximized apps cover the screen too but keep WS_CAPTION.
  '$style=[FG]::GetWindowLong($h,-16); $caption=(($style -band 0x00C00000) -eq 0x00C00000)',
  '$fs = (($r.R-$r.L) -ge $sw) -and (($r.B-$r.T) -ge $sh) -and (-not $caption)',
  '$p=Get-Process -Id $procId -ErrorAction SilentlyContinue',
  'if ($p) { $path=""; try { $path=$p.Path } catch {}; Write-Output ("{0}|{1}|{2}|{3}" -f $p.ProcessName, $p.MainWindowTitle, $path, $fs) }'
].join('\n')

export interface ForegroundApp {
  process: string
  title: string
  exePath: string
  fullscreen: boolean
}

function parseLine(line: string): ForegroundApp {
  const [process = '', title = '', exePath = '', fs = ''] = line.split('|')
  return { process: process.trim(), title: title.trim(), exePath: exePath.trim(), fullscreen: fs.trim() === 'True' }
}

/**
 * One long-lived PowerShell that answers "what's in front?" each time we write a line to it.
 * Spawning PowerShell every few seconds costs ~150 ms of CPU and a process start each time;
 * this keeps game detection close to free.
 */
class ForegroundWatcher {
  private proc: ChildProcessWithoutNullStreams | null = null
  private waiting: ((line: string) => void)[] = []
  private buf = ''
  private ready: Promise<void> | null = null

  private ensure() {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return
    const NL = String.fromCharCode(10)
    const body = PS_FOREGROUND.split(NL)
    const addType = body.slice(0, body.indexOf('"@') + 1).join(NL)
    const query = body.slice(body.indexOf('"@') + 1).join('; ').replace(/Write-Output \(/g, '$out = (')
    const loop = `while ($true) { $req = [Console]::In.ReadLine(); if ($req -eq $null) { break }; $out='|||False'; ${query}; [Console]::Out.WriteLine($out); [Console]::Out.Flush() }`
    const script = [addType, "$ErrorActionPreference='SilentlyContinue'", loop].join(NL)
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    this.proc = proc
    this.buf = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      this.buf += chunk
      let i: number
      while ((i = this.buf.indexOf(String.fromCharCode(10))) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '')
        this.buf = this.buf.slice(i + 1)
        this.waiting.shift()?.(line)
      }
    })
    proc.on('exit', () => {
      this.proc = null
      for (const w of this.waiting.splice(0)) w('|||False')
    })
    proc.stdin.on('error', () => undefined)
  }

  query(): Promise<ForegroundApp> {
    this.ensure()
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        // Wedged (e.g. first Add-Type compile is slow): drop the waiter and restart next time.
        const idx = this.waiting.indexOf(done)
        if (idx >= 0) this.waiting.splice(idx, 1)
        resolve(parseLine(''))
      }, 8000)
      const done = (line: string) => { clearTimeout(t); resolve(parseLine(line)) }
      this.waiting.push(done)
      this.proc?.stdin.write('q' + String.fromCharCode(10))
    })
  }

  dispose() {
    this.proc?.kill()
    this.proc = null
  }
}

const watcher = new ForegroundWatcher()

export function getForegroundApp(): Promise<ForegroundApp> {
  return watcher.query()
}

export function disposeForegroundWatcher() {
  watcher.dispose()
}

const SYSTEM_PROCS = new Set([
  'explorer', 'clipforge', 'electron', 'searchhost', 'startmenuexperiencehost', 'lockapp', 'shellexperiencehost',
  'applicationframehost', 'textinputhost', 'systemsettings', 'taskmgr', 'dwm', ''
])

/** Processes that are never games even if they go fullscreen. */
const NOT_GAMES = /^(chrome|msedge|firefox|opera|brave|discord|spotify|code|cursor|obs64|obs|vlc|potplayer(mini)?64|mpc-hc64|explorer|steam|steamwebhelper|epicgameslauncher|battle\.net|riotclientservices|unrealeditor|blender|photoshop|premiere pro|capcut|devenv|notepad\+\+|wordpad|winword|excel|powerpnt|teams|slack|zoom|medal|nvidia app|nzxt cam|sysmon|claude|chatgpt|notion|obsidian|figma|whatsapp|telegram|outlook|olk|msedgewebview2|windowsterminal|powershell|cmd|screenclippinghost|snippingtool|sharex|lightshot|gamebar|gamebarftserver|xboxpcappft|nvcontainer|nvidia overlay|rtss|msiafterburner)$/i

const GAME_PATH_HINTS = /steamapps|\\epic games\\|\\riot games\\|\\xboxgames\\|\\gog galaxy\\|\\gog games\\|\\battle\.net\\|\\ubisoft\\|\\ea games\\|\\origin games\\|\\games\\|\\minecraft|\\windowsapps\\/i

export function isSystemProcess(process: string) {
  return SYSTEM_PROCS.has(process.toLowerCase())
}

/** Our best guess at whether the foreground app is a game: install location, fullscreen, or user-listed. */
export function looksLikeGame(fg: ForegroundApp, allowlist: string[] = []): boolean {
  const proc = fg.process.toLowerCase()
  if (isSystemProcess(proc) || NOT_GAMES.test(proc)) return false
  if (allowlist.some((a) => a.toLowerCase().replace(/\.exe$/, '') === proc)) return true
  if (GAME_PATH_HINTS.test(fg.exePath)) return true
  return fg.fullscreen
}

/** A friendlier game name: window title if it looks like one, else the process name. */
const FRIENDLY: Record<string, string> = {
  chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', opera: 'Opera', brave: 'Brave', discord: 'Discord', spotify: 'Spotify',
  code: 'VS Code', cursor: 'Cursor', obs64: 'OBS', steam: 'Steam', steamwebhelper: 'Steam', epicgameslauncher: 'Epic Games',
  unrealeditor: 'Unreal Editor', blender: 'Blender', capcut: 'CapCut', medal: 'Medal', claude: 'Claude', teams: 'Teams', slack: 'Slack'
}

export function gameNameFrom(fg: Pick<ForegroundApp, 'process' | 'title'>): string {
  if (isSystemProcess(fg.process)) return 'Desktop'
  const proc = fg.process.toLowerCase()
  // Browsers, launchers and tools: use the app name, not whatever tab/document is open.
  if (NOT_GAMES.test(proc)) return FRIENDLY[proc] ?? fg.process
  const t = fg.title.replace(/\s+[-–|].*$/, '').replace(/[™®]/g, '').trim()
  return t.length > 1 && t.length < 48 ? t : fg.process
}

export async function toGameInfo(fg: ForegroundApp, allowlist: string[]): Promise<GameInfo> {
  return {
    name: gameNameFrom(fg),
    process: fg.process.toLowerCase(),
    exePath: fg.exePath || undefined,
    icon: fg.exePath ? await cachedIcon(fg.process, fg.exePath) : undefined,
    fullscreen: fg.fullscreen,
    isGame: looksLikeGame(fg, allowlist)
  }
}

const iconCache = new Map<string, string | undefined>()

/** Extract the exe's icon once and keep it as a PNG in userData/icons. */
export async function cachedIcon(process: string, exePath: string): Promise<string | undefined> {
  const key = process.toLowerCase()
  if (iconCache.has(key)) return iconCache.get(key)
  const dir = path.join(app.getPath('userData'), 'icons')
  const file = path.join(dir, `${key.replace(/[^\w.-]+/g, '_')}.png`)
  if (fs.existsSync(file)) {
    iconCache.set(key, file)
    return file
  }
  try {
    fs.mkdirSync(dir, { recursive: true })
    const img = await app.getFileIcon(exePath, { size: 'large' })
    if (img.isEmpty()) throw new Error('empty')
    fs.writeFileSync(file, img.toPNG())
    iconCache.set(key, file)
    return file
  } catch {
    iconCache.set(key, undefined)
    return undefined
  }
}

export interface RunningApp {
  process: string
  title: string
  exePath: string
  icon?: string
}

/** Every app with a visible window right now: candidates for the allow/block lists. */
export function listRunningApps(): Promise<RunningApp[]> {
  const script = 'Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $p=""; try { $p=$_.Path } catch {}; "{0}|{1}|{2}" -f $_.ProcessName, $_.MainWindowTitle, $p }'
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000 }, async (_err, stdout) => {
      const seen = new Set<string>()
      const apps: RunningApp[] = []
      for (const line of String(stdout).split(LINE_BREAK)) {
        const [process = '', title = '', exePath = ''] = line.split('|')
        const key = process.trim().toLowerCase()
        if (!key || seen.has(key) || SYSTEM_PROCS.has(key)) continue
        seen.add(key)
        apps.push({ process: process.trim(), title: title.trim(), exePath: exePath.trim() })
      }
      for (const a of apps) if (a.exePath) a.icon = await cachedIcon(a.process, a.exePath)
      resolve(apps.sort((a, b) => a.process.localeCompare(b.process)))
    })
  })
}

export { nativeImage }
