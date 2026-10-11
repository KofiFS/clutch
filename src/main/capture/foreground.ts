import { app, nativeImage } from 'electron'
import { execFile } from 'node:child_process'
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
  '}',
  '"@',
  '$h=[FG]::GetForegroundWindow(); $procId=0; [FG]::GetWindowThreadProcessId($h,[ref]$procId) | Out-Null',
  '$r=New-Object RECT; [FG]::GetWindowRect($h,[ref]$r) | Out-Null',
  '$sw=[FG]::GetSystemMetrics(0); $sh=[FG]::GetSystemMetrics(1)',
  '$fs = (($r.R-$r.L) -ge $sw) -and (($r.B-$r.T) -ge $sh)',
  '$p=Get-Process -Id $procId -ErrorAction SilentlyContinue',
  'if ($p) { $path=""; try { $path=$p.Path } catch {}; Write-Output ("{0}|{1}|{2}|{3}" -f $p.ProcessName, $p.MainWindowTitle, $path, $fs) }'
].join('\n')

export interface ForegroundApp {
  process: string
  title: string
  exePath: string
  fullscreen: boolean
}

export function getForegroundApp(): Promise<ForegroundApp> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_FOREGROUND], { windowsHide: true, timeout: 6000 }, (_err, stdout) => {
      const line = String(stdout).trim().split(LINE_BREAK).pop() ?? ''
      const [process = '', title = '', exePath = '', fs = ''] = line.split('|')
      resolve({ process: process.trim(), title: title.trim(), exePath: exePath.trim(), fullscreen: fs.trim() === 'True' })
    })
  })
}

const SYSTEM_PROCS = new Set([
  'explorer', 'clipforge', 'electron', 'searchhost', 'startmenuexperiencehost', 'lockapp', 'shellexperiencehost',
  'applicationframehost', 'textinputhost', 'systemsettings', 'taskmgr', 'dwm', ''
])

/** Processes that are never games even if they go fullscreen. */
const NOT_GAMES = /^(chrome|msedge|firefox|opera|brave|discord|spotify|code|cursor|obs64|obs|vlc|potplayer(mini)?64|mpc-hc64|explorer|steam|steamwebhelper|epicgameslauncher|battle\.net|riotclientservices|unrealeditor|blender|photoshop|premiere pro|capcut|devenv|notepad\+\+|wordpad|winword|excel|powerpnt|teams|slack|zoom|medal|nvidia app|nzxt cam|sysmon)$/i

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
