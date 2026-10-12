// Measures what Clutch costs while it records, so "lightweight" comes with numbers.
//
//   node scripts/benchmark.mjs [seconds=60]
//
// Start recording first (ideally in a game at 1080p 60 fps, Clutch's default quality), then run
// this. It adds up every process Clutch runs (the app, FFmpeg, its PowerShell helpers), samples
// CPU time and memory over the window, reads the NVIDIA encoder load when nvidia-smi exists, and
// writes the result to benchmark-<date>.json next to this script. Share that file with the specs.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const seconds = Math.max(10, Number(process.argv[2] ?? 60))
const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', windowsHide: true })

/** Clutch's processes: the app (Clutch.exe, or electron.exe when run from source) and its children. */
function snapshot() {
  const json = ps(`
    $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
    $roots = $all | Where-Object { $_.Name -eq 'Clutch.exe' -or ($_.Name -eq 'electron.exe' -and $_.CommandLine -match 'ClipForge|clutch') }
    $ids = New-Object System.Collections.Generic.HashSet[int]
    foreach ($r in $roots) { [void]$ids.Add([int]$r.ProcessId) }
    do { $added = $false; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $added = $true } } } while ($added)
    $out = foreach ($id in $ids) { $g = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($g) { [pscustomobject]@{ id = $id; name = $g.ProcessName; cpu = $g.TotalProcessorTime.TotalMilliseconds; ws = $g.WorkingSet64; priv = $g.PrivateMemorySize64 } } }
    ConvertTo-Json -InputObject @($out) -Compress`)
  return JSON.parse(json || '[]')
}

function gpuEncoder() {
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=name,utilization.gpu,utilization.encoder', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true })
    const [name, gpu, enc] = out.trim().split('\n')[0].split(',').map((s) => s.trim())
    return { name, gpuPercent: Number(gpu), encoderPercent: Number(enc) }
  } catch { return null }
}

const before = snapshot()
if (!before.length) { console.error('Clutch is not running.'); process.exit(1) }
if (!before.some((p) => p.name === 'ffmpeg')) console.warn('Note: Clutch is not recording right now, so this measures it idle.')
console.log(`Measuring ${seconds}s across ${before.length} Clutch processes…`)
const gpuSamples = []
const t0 = Date.now()
const timer = setInterval(() => { const g = gpuEncoder(); if (g) gpuSamples.push(g) }, 5000)
await new Promise((r) => setTimeout(r, seconds * 1000))
clearInterval(timer)
const after = snapshot()
const elapsed = Date.now() - t0
const cores = os.cpus().length

const byName = {}
for (const p of after) {
  const prev = before.find((b) => b.id === p.id)
  const cpuMs = p.cpu - (prev?.cpu ?? p.cpu)
  const e = (byName[p.name] ??= { processes: 0, cpuMs: 0, workingSetMB: 0, privateMB: 0 })
  e.processes++
  e.cpuMs += cpuMs
  e.workingSetMB += p.ws / 1048576
  e.privateMB += p.priv / 1048576
}
const rows = Object.entries(byName).map(([name, e]) => ({
  name,
  processes: e.processes,
  cpuPercentOfPC: +((e.cpuMs / elapsed / cores) * 100).toFixed(2),
  cpuPercentOfOneCore: +((e.cpuMs / elapsed) * 100).toFixed(1),
  workingSetMB: Math.round(e.workingSetMB),
  privateMB: Math.round(e.privateMB)
}))
const total = rows.reduce((t, r) => ({ cpuPercentOfPC: t.cpuPercentOfPC + r.cpuPercentOfPC, workingSetMB: t.workingSetMB + r.workingSetMB, privateMB: t.privateMB + r.privateMB }), { cpuPercentOfPC: 0, workingSetMB: 0, privateMB: 0 })
const avg = (k) => (gpuSamples.length ? +(gpuSamples.reduce((t, g) => t + g[k], 0) / gpuSamples.length).toFixed(1) : null)

const result = {
  date: new Date().toISOString(),
  seconds,
  pc: { cpu: os.cpus()[0]?.model, cores, ramGB: Math.round(os.totalmem() / 1073741824), gpu: gpuSamples[0]?.name ?? null, windows: os.release() },
  total: { cpuPercentOfPC: +total.cpuPercentOfPC.toFixed(2), workingSetMB: total.workingSetMB, privateMB: total.privateMB },
  gpu: gpuSamples.length ? { gpuPercent: avg('gpuPercent'), encoderPercent: avg('encoderPercent') } : null,
  processes: rows.sort((a, b) => b.cpuPercentOfPC - a.cpuPercentOfPC)
}
console.table(rows)
console.log(`Total: ${result.total.cpuPercentOfPC}% of the CPU (${cores} threads), ${result.total.workingSetMB} MB working set, ${result.total.privateMB} MB private.`)
if (result.gpu) console.log(`GPU: ${result.gpu.gpuPercent}% busy overall (includes the game), NVENC encoder ${result.gpu.encoderPercent}%.`)
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), `benchmark-${result.date.slice(0, 19).replace(/[:T]/g, '-')}.json`)
fs.writeFileSync(file, JSON.stringify(result, null, 2))
console.log(`Saved ${file}`)
