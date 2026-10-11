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

/** Which app is in front right now. Used to tag clips with the game name and to apply allow/block lists. */
export function getForegroundApp(): Promise<ForegroundApp> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
      { windowsHide: true, timeout: 5000 },
      (_err, stdout) => {
        const line = String(stdout).trim().split(/\r?\n/).pop() ?? ''
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
