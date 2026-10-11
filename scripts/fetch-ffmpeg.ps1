<#
  Puts ffmpeg.exe and ffprobe.exe into resources/ffmpeg so the installer can bundle them.

    pwsh scripts/fetch-ffmpeg.ps1             # download the latest GPL build (BtbN, used by CI)
    pwsh scripts/fetch-ffmpeg.ps1 -FromPath   # copy the ffmpeg already installed on this PC

  The build must include ddagrab (desktop duplication) and the NVENC/AMF/QSV encoders.
  Both gyan.dev "full" and BtbN "gpl" Windows builds do. These builds are GPL licensed:
  see THIRD_PARTY_NOTICES.md for what that means when you distribute the installer.
#>
param([switch]$FromPath)
$ErrorActionPreference = 'Stop'
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
  exit 0
}

$url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
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
  Write-Host "FFmpeg ready in $dest"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
