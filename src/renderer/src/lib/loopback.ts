/**
 * System-audio capture. Electron answers getDisplayMedia with the screen + `loopback` audio
 * (see setDisplayMediaRequestHandler in main). An AudioWorklet converts the stream into
 * 16-bit stereo 48 kHz PCM and pushes ~100 ms chunks to the main process, which pipes them into FFmpeg.
 * The worklet itself lives in public/pcm-worklet.js.
 */

let ctx: AudioContext | null = null
let stream: MediaStream | null = null

export async function startLoopback(): Promise<void> {
  if (ctx) return
  stream = await navigator.mediaDevices.getDisplayMedia({
    // Raw game audio: no voice processing, keep stereo.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
    video: true
  })
  stream.getVideoTracks().forEach((t) => t.stop())
  if (!stream.getAudioTracks().length) throw new Error('No system audio track was provided')
  ctx = new AudioContext({ sampleRate: 48000 })
  // Served as a static file: blob: module URLs are refused for worklets under the file:// origin.
  await ctx.audioWorklet.addModule(new URL('./pcm-worklet.js', document.baseURI).toString())
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm-sender', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2 })
  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; db: number }>) => window.cf.audio.push(e.data.pcm, e.data.db)
  src.connect(node)
}

export function stopLoopback() {
  stream?.getTracks().forEach((t) => t.stop())
  void ctx?.close()
  ctx = null
  stream = null
}

export function loopbackActive() {
  return !!ctx
}

/**
 * Lightweight level meter for onboarding / settings previews. Works without FFmpeg.
 * `source` = 'mic' uses getUserMedia (optionally matching a device label), 'system' uses loopback.
 */
export async function startMeter(source: 'mic' | 'system', onLevel: (db: number) => void, deviceLabel?: string): Promise<() => void> {
  let s: MediaStream
  if (source === 'system') {
    s = await navigator.mediaDevices.getDisplayMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: true })
    s.getVideoTracks().forEach((t) => t.stop())
  } else {
    let deviceId: string | undefined
    if (deviceLabel) {
      // Labels are only visible after one permission grant; try, then match.
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        probe.getTracks().forEach((t) => t.stop())
      } catch { /* ignore */ }
      const devices = await navigator.mediaDevices.enumerateDevices()
      const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').replace(/[()]/g, '').trim()
      const match = devices.find((d) => d.kind === 'audioinput' && norm(d.label).includes(norm(deviceLabel).slice(0, 24)))
      deviceId = match?.deviceId
    }
    s = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : { echoCancellation: false, noiseSuppression: false } })
  }
  const ac = new AudioContext()
  const an = ac.createAnalyser()
  an.fftSize = 2048
  ac.createMediaStreamSource(s).connect(an)
  const buf = new Float32Array(an.fftSize)
  // setInterval rather than requestAnimationFrame: rAF pauses when the window is occluded.
  const timer = setInterval(() => {
    an.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    onLevel(rms > 0 ? 20 * Math.log10(rms) : -100)
  }, 80)
  return () => {
    clearInterval(timer)
    s.getTracks().forEach((t) => t.stop())
    void ac.close()
  }
}
