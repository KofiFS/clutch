import { lowerPriority } from './ffmpeg'
import { app, nativeImage } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { GameInfo } from '../../shared/types'
import { cleanGameName } from '../../shared/types'

const LINE_BREAK = /\r?\n/

// Foreground window: process name, title, exe path, and whether it covers the whole monitor.
/*
 * Asked every few seconds while a game runs, so it must not touch the game itself.
 * Anti-cheat (Easy Anti-Cheat, BattlEye, Vanguard) watches for other programs opening the game's
 * process. The old version read the path through Get-Process(...).Path, which opens the process
 * with memory-read rights and walks its modules; in Fortnite that lined up with the picture
 * freezing every 3 s. Now:
 *  - the path comes from QueryFullProcessImageName with PROCESS_QUERY_LIMITED_INFORMATION, the
 *    one right anti-cheat allows, and only when the window in front changes;
 *  - the title is read from the foreground window itself;
 *  - the process name comes from that path (or the system process list, which opens nothing).
 */
const PS_FOREGROUND = [
  'Add-Type @"',
  'using System; using System.Text; using System.Runtime.InteropServices;',
  'public struct RECT { public int L; public int T; public int R; public int B; }',
  'public class FG {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);',
  '  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);',
  '  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);',
  '  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);',
  '  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder s, ref uint n);',
  '  public static string PathOf(uint pid) {',
  '    IntPtr h = OpenProcess(0x1000, false, pid); if (h == IntPtr.Zero) return "";',
  '    try { var sb = new StringBuilder(1024); uint n = 1024; return QueryFullProcessImageName(h, 0, sb, ref n) ? sb.ToString() : ""; } finally { CloseHandle(h); }',
  '  }',
  '  public static string TitleOf(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }',
  '}',
  '"@',
  '$h=[FG]::GetForegroundWindow(); $procId=[uint32]0; [FG]::GetWindowThreadProcessId($h,[ref]$procId) | Out-Null',
  '$r=New-Object RECT; [FG]::GetWindowRect($h,[ref]$r) | Out-Null',
  '$sw=[FG]::GetSystemMetrics(0); $sh=[FG]::GetSystemMetrics(1)',
  // Fullscreen = covers the screen AND has no title bar. Maximized apps cover the screen too but keep WS_CAPTION.
  '$style=[FG]::GetWindowLong($h,-16); $caption=(($style -band 0x00C00000) -eq 0x00C00000)',
  '$fs = (($r.R-$r.L) -ge $sw) -and (($r.B-$r.T) -ge $sh) -and (-not $caption)',
  'if ($procId -ne $lastPid) { $lastPid=$procId; $lastPath=[FG]::PathOf($procId); if ($lastPath) { $lastName=[IO.Path]::GetFileNameWithoutExtension($lastPath) } else { $lastName=(Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName } }',
  '$watch=0; [void][int]::TryParse(($req -replace "^q\\s*",""), [ref]$watch); $alive=$false; if ($watch -gt 0) { $alive=[bool](Get-Process -Id $watch -ErrorAction SilentlyContinue) }',
  'if ($procId -and $lastName) { $title=([FG]::TitleOf($h)) -replace "[|]"," "; Write-Output ("{0}|{1}|{2}|{3}|{4}|{5}" -f $lastName, $title, $lastPath, $fs, $procId, $alive) } else { Write-Output ("|||False|0|{0}" -f $alive) }'
].join('\n')

/** Open windows, for "Pick a game" and the already-running scan. Uses the same limited path lookup. */
const PS_APPS = '$out = ((Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "{0}|{1}|{2}|{3}" -f $_.ProcessName, ($_.MainWindowTitle -replace "[|]"," "), [FG]::PathOf([uint32]$_.Id), $_.Id }) -join [char]31)'

/** Runs once when the helper starts: the cache that keeps repeat questions from touching the game. */
const PS_INIT = '$lastPid=0; $lastPath=""; $lastName=""'

export interface ForegroundApp {
  process: string
  title: string
  exePath: string
  fullscreen: boolean
  pid?: number
  /** Whether the process id passed to the query is still running. */
  watchedAlive?: boolean
}

function parseLine(line: string): ForegroundApp {
  const [process = '', title = '', exePath = '', fs = '', pid = '0', alive = ''] = line.split('|')
  return { process: process.trim(), title: title.trim(), exePath: exePath.trim(), fullscreen: fs.trim() === 'True', pid: Number(pid) || 0, watchedAlive: alive.trim() === 'True' }
}

/**
 * One long-lived PowerShell that answers "what's in front?" each time we write a line to it.
 * Spawning PowerShell every few seconds costs ~150 ms of CPU and a process start each time;
 * this keeps game detection close to free.
 */
class ForegroundWatcher {
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<number, (payload: string) => void>()
  private nextId = 1
  private buf = ''
  private ready: Promise<void> | null = null

  private ensure() {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return
    const NL = String.fromCharCode(10)
    const body = PS_FOREGROUND.split(NL)
    const addType = body.slice(0, body.indexOf('"@') + 1).join(NL)
    const query = body.slice(body.indexOf('"@') + 1).join('; ').replace(/Write-Output \(/g, '$out = (')
    // Requests: "<id> fg <watch pid>" or "<id> apps". Answers: "<id><TAB><payload>", so a late answer
    // can never be handed to the wrong caller.
    const loop = `while ($true) { $line = [Console]::In.ReadLine(); if ($line -eq $null) { break }; $parts = $line.Split(' '); $rid = $parts[0]; if ($parts[1] -eq 'apps') { ${PS_APPS} } else { $req = 'q ' + $parts[2]; $out='|||False'; ${query} }; [Console]::Out.WriteLine($rid + [char]9 + $out); [Console]::Out.Flush() }`
    const script = [addType, "$ErrorActionPreference='SilentlyContinue'", PS_INIT, loop].join(NL)
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    lowerPriority(proc.pid)
    this.proc = proc
    this.buf = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      this.buf += chunk
      let i: number
      while ((i = this.buf.indexOf(String.fromCharCode(10))) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '')
        this.buf = this.buf.slice(i + 1)
        const tab = line.indexOf(String.fromCharCode(9))
        const id = Number(line.slice(0, tab))
        const fn = this.pending.get(id)
        if (tab > 0 && fn) { this.pending.delete(id); fn(line.slice(tab + 1)) }
      }
    })
    proc.on('exit', () => {
      this.proc = null
      for (const fn of this.pending.values()) fn('')
      this.pending.clear()
    })
    proc.stdin.on('error', () => undefined)
  }

  private ask(kind: string, timeoutMs = 8000): Promise<string> {
    this.ensure()
    const id = this.nextId++
    return new Promise((resolve) => {
      // Wedged (e.g. the first Add-Type compile is slow): give up on this one; the id keeps a late
      // answer from reaching anyone else.
      const t = setTimeout(() => { this.pending.delete(id); resolve('') }, timeoutMs)
      this.pending.set(id, (payload) => { clearTimeout(t); resolve(payload) })
      this.proc?.stdin.write(`${id} ${kind}` + String.fromCharCode(10))
    })
  }

  /** What's in front; with `watchPid`, also whether that process is still running. */
  async query(watchPid = 0): Promise<ForegroundApp> {
    return parseLine(await this.ask(`fg ${watchPid}`))
  }

  /** Open windows: "process|title|path|pid" entries. */
  async apps(): Promise<string[]> {
    const out = await this.ask('apps', 10_000)
    return out ? out.split(String.fromCharCode(31)) : []
  }

  dispose() {
    this.proc?.kill()
    this.proc = null
  }
}

const watcher = new ForegroundWatcher()

export function getForegroundApp(watchPid = 0): Promise<ForegroundApp> {
  return watcher.query(watchPid)
}

export function disposeForegroundWatcher() {
  watcher.dispose()
}

const SYSTEM_PROCS = new Set([
  'explorer', 'clipforge', 'clutch', 'electron', 'searchhost', 'startmenuexperiencehost', 'lockapp', 'shellexperiencehost',
  'applicationframehost', 'textinputhost', 'systemsettings', 'taskmgr', 'dwm', ''
])

/** Processes that are never games even if they go fullscreen. */
const NOT_GAMES = /^(chrome|msedge|firefox|opera|brave|discord|spotify|code|cursor|obs64|obs|vlc|potplayer(mini)?64|mpc-hc64|explorer|steam|steamwebhelper|epicgameslauncher|battle\.net|riotclientservices|unrealeditor|blender|photoshop|premiere pro|capcut|devenv|notepad\+\+|wordpad|winword|excel|powerpnt|teams|slack|zoom|medal|nvidia app|nzxt cam|sysmon|claude|chatgpt|notion|obsidian|figma|whatsapp|telegram|outlook|olk|msedgewebview2|windowsterminal|powershell|cmd|screenclippinghost|snippingtool|sharex|lightshot|gamebar|gamebarftserver|xboxpcappft|nvcontainer|nvidia overlay|rtss|msiafterburner|phoneexperiencehost|yourphone|crossdeviceservice|calculatorapp|photos|microsoft\.media\.player|windowscamera|xboxpcapp|xboxapp|gamingservices|msteams|ms-teams|onedrive|searchhost|startmenuexperiencehost|shellexperiencehost|textinputhost|lockapp|widgets|widgetservice|systemsettings|applicationframehost)$/i

const GAME_PATH_HINTS = /steamapps|\\epic ?games\\|\\riot games\\|\\xboxgames\\|\\gog galaxy\\|\\gog games\\|\\battle\.net\\|\\ubisoft\\|\\ea games\\|\\origin games\\|\\games\\|\\minecraft/i

export function isSystemProcess(process: string) {
  return SYSTEM_PROCS.has(process.toLowerCase())
}

/** Our best guess at whether the foreground app is a game: install location, fullscreen, or user-listed. */
export function looksLikeGame(fg: ForegroundApp, allowlist: string[] = [], extraGames: string[] = []): boolean {
  const proc = fg.process.toLowerCase()
  if (isSystemProcess(proc)) return false
  const listed = (list: string[]) => list.some((a) => a.toLowerCase().replace(/\.exe$/, '') === proc)
  // The user's own choice wins over the built-in "not a game" list.
  if (listed(extraGames) || listed(allowlist)) return true
  if (NOT_GAMES.test(proc)) return false
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
  const t = cleanGameName(fg.title.replace(/\s+[-–|].*$/, '').replace(/[™®]/g, '').trim())
  return t.length > 1 && t.length < 48 ? t : fg.process
}

export async function toGameInfo(fg: ForegroundApp, allowlist: string[], extraGames: string[] = []): Promise<GameInfo> {
  return {
    name: gameNameFrom(fg),
    process: fg.process.toLowerCase(),
    exePath: fg.exePath || undefined,
    // No icon for the desktop / Clutch itself: the UI shows a monitor glyph instead of e.g. the Electron logo.
    icon: fg.exePath && !isSystemProcess(fg.process) ? await cachedIcon(fg.process, fg.exePath) : undefined,
    fullscreen: fg.fullscreen,
    isGame: looksLikeGame(fg, allowlist, extraGames)
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
  pid?: number
  isGame?: boolean
}

/** Every app with a visible window right now: candidates for the allow/block lists. */
/**
 * Apps with a window. Paths come from QueryFullProcessImageName with limited rights (the process list
 * itself opens nothing): reading Process.Path instead opens every app with memory-read rights, which
 * takes ~0.8 s per anti-cheat-protected game and is exactly what anti-cheat watches for.
 */
export async function listRunningApps(extraGames: string[] = [], allowlist: string[] = []): Promise<RunningApp[]> {
  const seen = new Set<string>()
  const apps: RunningApp[] = []
  for (const line of await watcher.apps()) {
    const [process = '', title = '', exePath = '', pid = '0'] = line.split('|')
    const key = process.trim().toLowerCase()
    if (!key || seen.has(key) || SYSTEM_PROCS.has(key)) continue
    seen.add(key)
    const app: RunningApp = { process: process.trim(), title: title.trim(), exePath: exePath.trim(), pid: Number(pid) || undefined }
    app.isGame = looksLikeGame({ process: app.process, title: app.title, exePath: app.exePath, fullscreen: false }, allowlist, extraGames)
    apps.push(app)
  }
  for (const a of apps) if (a.exePath) a.icon = await cachedIcon(a.process, a.exePath)
  return apps.sort((a, b) => a.process.localeCompare(b.process))
}

export { nativeImage }

export interface WindowRect {
  x: number
  y: number
  w: number
  h: number
  minimized: boolean
  /** Window handle, for capturing the window itself (Windows Graphics Capture). */
  hwnd: string
}

/** Screen rectangle (physical pixels, without the invisible resize border) of a process's main window. */
export function getWindowRect(processName: string): Promise<WindowRect | null> {
  const name = processName.replace(/\.exe$/i, '').replace(/[^\w.\- ]/g, '')
  if (!name) return Promise.resolve(null)
  const script = [
    'Add-Type @"',
    'using System; using System.Runtime.InteropServices;',
    'public struct WRECT { public int L; public int T; public int R; public int B; }',
    'public class WR {',
    '  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out WRECT r, int s);',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out WRECT r);',
    '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
    '}',
    '"@',
    `$p = Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1`,
    'if ($p) { $r = New-Object WRECT; if ([WR]::DwmGetWindowAttribute($p.MainWindowHandle, 9, [ref]$r, 16) -ne 0) { [WR]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null }; Write-Output ("{0}|{1}|{2}|{3}|{4}|{5}" -f $r.L, $r.T, $r.R, $r.B, [WR]::IsIconic($p.MainWindowHandle), $p.MainWindowHandle.ToInt64()) }'
  ].join(String.fromCharCode(10))
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000 }, (_err, stdout) => {
      const line = String(stdout).trim().split(LINE_BREAK).pop() ?? ''
      const [l, t, r, b, min, hwnd] = line.split('|')
      const L = Number(l), T = Number(t), R = Number(r), B = Number(b)
      if (!Number.isFinite(L) || R - L < 2 || B - T < 2) return resolve(null)
      resolve({ x: L, y: T, w: R - L, h: B - T, minimized: (min ?? '').trim() === 'True', hwnd: (hwnd ?? '').trim() })
    })
  })
}
