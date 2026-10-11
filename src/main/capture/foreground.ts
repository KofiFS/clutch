import { execFile } from 'node:child_process'

const PS_SCRIPT = [
  'Add-Type @"',
  'using System; using System.Runtime.InteropServices;',
  'public class FG { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }',
  '"@',
  '$h=[FG]::GetForegroundWindow(); $procId=0; [FG]::GetWindowThreadProcessId($h,[ref]$procId) | Out-Null',
  '$p=Get-Process -Id $procId -ErrorAction SilentlyContinue',
  'if ($p) { Write-Output ("{0}|{1}" -f $p.ProcessName, $p.MainWindowTitle) }'
].join('\n')

export interface ForegroundApp {
  process: string
  title: string
}

const LINE_BREAK = /\r?\n/

/** Which app is in front right now. Used to tag clips with the game name and to apply allow/block lists. */
export function getForegroundApp(): Promise<ForegroundApp> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
      { windowsHide: true, timeout: 5000 },
      (_err, stdout) => {
        const line = String(stdout).trim().split(LINE_BREAK).pop() ?? ''
        const [process = '', title = ''] = line.split('|')
        resolve({ process: process.trim(), title: title.trim() })
      }
    )
  })
}

const SYSTEM_PROCS = new Set([
  'explorer', 'clipforge', 'electron', 'searchhost', 'startmenuexperiencehost',
  'lockapp', 'shellexperiencehost', 'applicationframehost', 'textinputhost', ''
])

/** A friendlier game name: window title if it looks like one, else the process name. */
export function gameNameFrom(app: ForegroundApp): string {
  if (SYSTEM_PROCS.has(app.process.toLowerCase())) return 'Desktop'
  const t = app.title.replace(/\s+[-–|].*$/, '').trim()
  return t.length > 1 && t.length < 48 ? t : app.process
}

/** Every app with a visible window right now: candidates for the allow/block lists. */
export function listRunningApps(): Promise<ForegroundApp[]> {
  const script = 'Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "{0}|{1}" -f $_.ProcessName, $_.MainWindowTitle }'
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000 }, (_err, stdout) => {
      const seen = new Set<string>()
      const apps: ForegroundApp[] = []
      for (const line of String(stdout).split(LINE_BREAK)) {
        const [process = '', title = ''] = line.split('|')
        const key = process.trim().toLowerCase()
        if (!key || seen.has(key) || SYSTEM_PROCS.has(key)) continue
        seen.add(key)
        apps.push({ process: process.trim(), title: title.trim() })
      }
      resolve(apps.sort((a, b) => a.process.localeCompare(b.process)))
    })
  })
}
