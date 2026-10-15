<#
  Puts ffmpeg.exe and ffprobe.exe into resources/ffmpeg so the installer can bundle them.

    pwsh scripts/fetch-ffmpeg.ps1             # download the FFmpeg 9.0 GPL build (BtbN, used by CI)
    pwsh scripts/fetch-ffmpeg.ps1 -FromPath   # copy the ffmpeg already installed on this PC

  The build must include ddagrab (desktop duplication) and the NVENC/AMF/QSV encoders.
  Both gyan.dev "full" and BtbN "gpl" Windows builds do. These builds are GPL licensed:
  see THIRD_PARTY_NOTICES.md for what that means when you distribute the installer.
#>
param([switch]$FromPath)
$ErrorActionPreference = 'Stop'

# Fails the build when the bundled FFmpeg can't run Clutch's commands: the input options it
# passes, the capture sources and the encoders. Runs without a GPU or desktop (CI).
function Test-ClutchFfmpeg([string]$ff) {
  $problems = @()
  $probe = { param($argList) $p = Start-Process -FilePath $ff -ArgumentList $argList -NoNewWindow -Wait -PassThru -RedirectStandardError "$env:TEMP\ffcheck.txt" -RedirectStandardOutput "$env:TEMP\ffcheck.out"; $p.ExitCode }
  # Input options exactly as the recorder uses them, before an input.
  if ((& $probe '-hide_banner -loglevel error -thread_queue_size 2048 -f lavfi -i anullsrc=r=48000:cl=stereo -t 0.2 -c:a aac -f mpegts NUL') -ne 0) { $problems += "input options rejected: $(Get-Content $env:TEMP\ffcheck.txt -Raw)" }
  if ((& $probe "-hide_banner -loglevel error -f lavfi -i testsrc2=s=320x180:r=30 -t 1 -c:v libx264 -g 60 -force_key_frames expr:gte(t,n_forced*2) -f segment -segment_time 2 -segment_format mpegts -reset_timestamps 1 `"$env:TEMP\ffcheck%03d.ts`"") -ne 0) { $problems += "segment recording rejected: $(Get-Content $env:TEMP\ffcheck.txt -Raw)" }
  $filters = (& $ff -hide_banner -filters 2>&1) -join "`n"
  foreach ($f in 'ddagrab', 'gfxcapture', 'astats', 'amix') { if ($filters -notmatch "\b$f\b") { $problems += "missing filter $f" } }
  $enc = (& $ff -hide_banner -encoders 2>&1) -join "`n"
  foreach ($e in 'h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'h264_amf', 'h264_qsv', 'libx264', 'aac') { if ($enc -notmatch "\b$e\b") { $problems += "missing encoder $e" } }
  $dem = (& $ff -hide_banner -demuxers 2>&1) -join "`n"
  if ($dem -notmatch '\bdshow\b') { $problems += 'missing dshow input (microphones)' }
  if ($problems.Count) { throw "This FFmpeg can't run Clutch:`n - " + ($problems -join "`n - ") }
  Write-Host 'FFmpeg check passed: options, capture filters and encoders are all there.'
}
$dest = Join-Path $PSScriptRoot '..\resources\ffmpeg'
New-Item -ItemType Directory -Force $dest | Out-Null

if ($FromPath) {
  $cmd = Get-Command ffmpeg -ErrorAction Stop
  $exe = (Get-Item $cmd.Source).Target
  if (-not $exe) { $exe = $cmd.Source }
  if ($exe -is [array]) { $exe = $exe[0] }
  $bin = Split-Path $exe
  Copy-Item (Join-Path $bin 'ffmpeg.exe'), (Join-Path $bin 'ffprobe.exe') $dest -Force
  $lic = Get-ChildItem (Split-Path $bin) -Filter 'LICENSE*' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($lic) { Copy-Item $lic.FullName (Join-Path $dest 'LICENSE.txt') -Force }
  Write-Host "Copied FFmpeg from $bin"
  Test-ClutchFfmpeg (Join-Path $dest 'ffmpeg.exe')
  exit 0
}

# The 9.0 release branch, never "master": nightly master builds change options without notice
# (2026-10-15 made -thread_queue_size output-only, which broke every recording).
$url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-9.0.zip'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("ffmpeg-" + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
try {
  Write-Host "Downloading $url"
  Invoke-WebRequest $url -OutFile (Join-Path $tmp 'ffmpeg.zip')
  Expand-Archive (Join-Path $tmp 'ffmpeg.zip') $tmp
  $root = Get-ChildItem $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'bin\ffmpeg.exe') } | Select-Object -First 1
  Copy-Item (Join-Path $root.FullName 'bin\ffmpeg.exe'), (Join-Path $root.FullName 'bin\ffprobe.exe') $dest -Force
  Copy-Item (Join-Path $root.FullName 'LICENSE.txt') $dest -Force -ErrorAction SilentlyContinue
  & (Join-Path $dest 'ffmpeg.exe') -hide_banner -version | Select-Object -First 1
  Test-ClutchFfmpeg (Join-Path $dest 'ffmpeg.exe')
  Write-Host "FFmpeg ready in $dest"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
