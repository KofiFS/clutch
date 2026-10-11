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
