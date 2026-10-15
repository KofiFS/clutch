# Clutch screen-text watcher: Windows' built-in text recognition (Windows.Media.Ocr), kept running.
# Reads one request per line on stdin: "<id>\t<image path>". Prints "<id>\t<text>" per image, where
# <text> is the recognized lines joined by " | " (empty when nothing was found). Offline, no install.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  function Await($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    [void]$task.Wait(-1)
    $task.Result
  }
  [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  [void][Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
  if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if (-not $engine) { [Console]::Out.WriteLine("ERROR`tNo text recognition language is installed in Windows."); exit 2 }
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  [Console]::Out.WriteLine("READY`t$($engine.RecognizerLanguage.LanguageTag)")
  [Console]::Out.Flush()
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null) { break }
    $parts = $line.Split("`t", 2)
    if ($parts.Count -lt 2) { continue }
    $text = ''
    try {
      $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($parts[1])) ([Windows.Storage.StorageFile])
      $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
      $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      $text = (@($result.Lines | ForEach-Object { $_.Text }) -join ' | ')
      $bitmap.Dispose(); $stream.Dispose()
    } catch { $text = '' }
    [Console]::Out.WriteLine("$($parts[0])`t$text")
    [Console]::Out.Flush()
  }
} catch {
  [Console]::Out.WriteLine("ERROR`t$($_.Exception.Message)")
  exit 1
}
