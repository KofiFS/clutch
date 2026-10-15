# Clutch voice commands: listens for a few spoken phrases with Windows' offline speech recognizer.
# Audio arrives on stdin as raw 16 kHz, 16-bit, mono PCM (Clutch pipes the chosen mic in).
# A general dictation grammar runs alongside the commands so ordinary talk matches it instead of
# being forced onto a command. Prints one line per event:
#   READY <recognizer>          the recognizer started
#   CMD <phrase> <confidence>   a command phrase was heard
#   HEARD <text> <confidence>   (only with -ShowAll) anything else that was recognized
#   ERROR <message>
param(
  [Parameter(Mandatory = $true)][string]$PhrasesB64,
  [string]$Culture = 'en-US',
  [switch]$ShowAll,
  # How ordinary talk is soaked up: 'dictation' (most accurate, more CPU) or 'wildcard' (lighter)
  [ValidateSet('dictation', 'wildcard')][string]$Filler = 'dictation'
)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  # SAPI only accepts seekable streams; a live pipe isn't. This wrapper reports itself as seekable
  # and fills every read from stdin, blocking until audio arrives (0 bytes = the input ended).
  Add-Type -TypeDefinition @'
using System; using System.IO;
public class LiveStream : Stream {
  readonly Stream src; long pos;
  public LiveStream(Stream s) { src = s; }
  public override bool CanRead { get { return true; } }
  public override bool CanSeek { get { return true; } }
  public override bool CanWrite { get { return false; } }
  public override long Length { get { return long.MaxValue; } }
  public override long Position { get { return pos; } set { } }
  public override long Seek(long o, SeekOrigin g) { return pos; }
  public override void SetLength(long v) { }
  public override void Write(byte[] b, int o, int c) { throw new NotSupportedException(); }
  public override void Flush() { }
  public override int Read(byte[] b, int o, int c) {
    int got = 0;
    while (got < c) { int n = src.Read(b, o + got, c - got); if (n <= 0) break; got += n; }
    pos += got; return got;
  }
}
'@
  $phrases = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PhrasesB64)) | ConvertFrom-Json
  $info = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq $Culture } | Select-Object -First 1
  if (-not $info) { $info = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1 }
  if (-not $info) { [Console]::Out.WriteLine('ERROR No English speech recognizer is installed in Windows.'); exit 2 }
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)

  $choices = New-Object System.Speech.Recognition.Choices
  foreach ($p in $phrases) { if ($p.Trim()) { $choices.Add($p.Trim().ToLowerInvariant()) } }
  $gb = New-Object System.Speech.Recognition.GrammarBuilder
  $gb.Culture = $info.Culture
  $gb.Append($choices)
  $cmd = New-Object System.Speech.Recognition.Grammar($gb)
  $cmd.Name = 'cmd'
  $engine.LoadGrammar($cmd)
  if ($Filler -eq 'dictation') {
    $free = New-Object System.Speech.Recognition.DictationGrammar
  } else {
    $wb = New-Object System.Speech.Recognition.GrammarBuilder
    $wb.Culture = $info.Culture
    $wb.AppendWildcard()
    $free = New-Object System.Speech.Recognition.Grammar($wb)
  }
  $free.Name = 'free'
  $engine.LoadGrammar($free)
  # Short pauses end a phrase quickly, so "clip that" fires right after it is said.
  $engine.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(350)
  $engine.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(500)

  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $engine.SetInputToAudioStream((New-Object LiveStream([Console]::OpenStandardInput())), $fmt)
  [void](Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -SourceIdentifier rec)
  [void](Register-ObjectEvent -InputObject $engine -EventName RecognizeCompleted -SourceIdentifier done)
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  [Console]::Out.WriteLine("READY $($info.Name)")
  [Console]::Out.Flush()
  while ($true) {
    $ev = Wait-Event
    Remove-Event -EventIdentifier $ev.EventIdentifier
    if ($ev.SourceIdentifier -eq 'done') { break } # input ended (Clutch stopped the mic)
    $r = $ev.SourceEventArgs.Result
    $conf = [Math]::Round($r.Confidence, 3)
    if ($r.Grammar.Name -eq 'cmd') { [Console]::Out.WriteLine("CMD`t$($r.Text)`t$conf") }
    elseif ($ShowAll) { [Console]::Out.WriteLine("HEARD`t$($r.Text)`t$conf") }
    [Console]::Out.Flush()
  }
} catch {
  [Console]::Out.WriteLine("ERROR $($_.Exception.Message)")
  exit 1
}
