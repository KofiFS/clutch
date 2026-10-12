# Captures one app's audio (and its child processes) with Windows' per-process loopback
# (Windows 10 2004+ / Windows 11, the same API OBS "Application Audio Capture" uses) and writes
# raw PCM to stdout: 48 kHz, stereo, 16-bit little-endian. No virtual cable needed.
#   powershell -MTA -File app-audio.ps1 <pid> [include|exclude]
# Status lines go to stderr. Exits when the target process ends or stdout closes.
param([int]$TargetPid, [string]$Mode = 'include')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class AppAudio {
  [StructLayout(LayoutKind.Sequential)]
  struct WAVEFORMATEX { public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize; }

  [StructLayout(LayoutKind.Sequential)]
  struct ACTIVATION_PARAMS { public int ActivationType; public uint TargetProcessId; public int ProcessLoopbackMode; }

  [StructLayout(LayoutKind.Explicit)]
  struct PROPVARIANT_BLOB { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public uint cbSize; [FieldOffset(16)] public IntPtr pBlobData; }

  [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IActivateAudioInterfaceAsyncOperation { void GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface); }

  [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IActivateAudioInterfaceCompletionHandler { void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op); }

  // Marker so Windows calls us back directly on its worker thread.
  [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAgileObject { }

  [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioClient {
    [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
    [PreserveSig] int GetBufferSize(out uint frames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint padding);
    [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long def, out long min);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr handle);
    [PreserveSig] int GetService([In] ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
  }

  [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioCaptureClient {
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
    [PreserveSig] int ReleaseBuffer(uint frames);
    [PreserveSig] int GetNextPacketSize(out uint frames);
  }

  class Handler : IActivateAudioInterfaceCompletionHandler, IAgileObject {
    public readonly ManualResetEvent Done = new ManualResetEvent(false);
    public object Client; public int Result = -1;
    public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op) {
      try { op.GetActivateResult(out Result, out Client); } catch (Exception) { Result = -2; }
      Done.Set();
    }
  }

  [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = true)]
  static extern int ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string path, [In] ref Guid riid, IntPtr activationParams, IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation op);

  public static int Run(int pid, bool include) {
    var p = new ACTIVATION_PARAMS { ActivationType = 1, TargetProcessId = (uint)pid, ProcessLoopbackMode = include ? 0 : 1 };
    IntPtr pParams = Marshal.AllocHGlobal(Marshal.SizeOf(p));
    Marshal.StructureToPtr(p, pParams, false);
    var pv = new PROPVARIANT_BLOB { vt = 65 /* VT_BLOB */, cbSize = (uint)Marshal.SizeOf(p), pBlobData = pParams };
    IntPtr pPv = Marshal.AllocHGlobal(Marshal.SizeOf(pv));
    Marshal.StructureToPtr(pv, pPv, false);

    var handler = new Handler();
    Guid iidClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    IActivateAudioInterfaceAsyncOperation op;
    int hr = ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iidClient, pPv, handler, out op);
    if (hr != 0) { Console.Error.WriteLine("activate failed 0x" + hr.ToString("X8")); return 2; }
    if (!handler.Done.WaitOne(5000) || handler.Result != 0 || handler.Client == null) { Console.Error.WriteLine("activate result 0x" + handler.Result.ToString("X8")); return 3; }
    var client = (IAudioClient)handler.Client;

    var fmt = new WAVEFORMATEX { wFormatTag = 1, nChannels = 2, nSamplesPerSec = 48000, wBitsPerSample = 16, nBlockAlign = 4, nAvgBytesPerSec = 48000 * 4, cbSize = 0 };
    IntPtr pFmt = Marshal.AllocHGlobal(Marshal.SizeOf(fmt));
    Marshal.StructureToPtr(fmt, pFmt, false);
    // LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY
    uint flags = 0x00020000 | 0x00040000 | 0x80000000 | 0x08000000;
    hr = client.Initialize(0, flags, 200000 /* 20 ms */, 0, pFmt, IntPtr.Zero);
    if (hr != 0) { Console.Error.WriteLine("initialize failed 0x" + hr.ToString("X8")); return 4; }
    var ev = new AutoResetEvent(false);
    client.SetEventHandle(ev.SafeWaitHandle.DangerousGetHandle());
    Guid iidCapture = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
    object svc;
    hr = client.GetService(ref iidCapture, out svc);
    if (hr != 0) { Console.Error.WriteLine("capture client failed 0x" + hr.ToString("X8")); return 5; }
    var capture = (IAudioCaptureClient)svc;
    hr = client.Start();
    if (hr != 0) { Console.Error.WriteLine("start failed 0x" + hr.ToString("X8")); return 6; }
    Console.Error.WriteLine("capturing pid " + pid + (include ? " (with child processes)" : " (everything except it)"));

    Stream stdout = Console.OpenStandardOutput();
    byte[] buf = new byte[48000 * 4];
    System.Diagnostics.Process target = null;
    try { target = System.Diagnostics.Process.GetProcessById(pid); } catch (Exception) { }
    while (true) {
      ev.WaitOne(200);
      if (target != null && target.HasExited) return 0;
      uint packet;
      while (capture.GetNextPacketSize(out packet) == 0 && packet > 0) {
        IntPtr data; uint frames, bflags; ulong dp, qp;
        if (capture.GetBuffer(out data, out frames, out bflags, out dp, out qp) != 0) break;
        int bytes = (int)frames * 4;
        if (bytes > buf.Length) buf = new byte[bytes];
        if ((bflags & 0x2) != 0) Array.Clear(buf, 0, bytes); // AUDCLNT_BUFFERFLAGS_SILENT
        else Marshal.Copy(data, buf, 0, bytes);
        capture.ReleaseBuffer(frames);
        try { stdout.Write(buf, 0, bytes); stdout.Flush(); } catch (IOException) { return 0; }
      }
    }
  }
}
"@
exit [AppAudio]::Run($TargetPid, $Mode -ne 'exclude')
