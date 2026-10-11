class PcmSender extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.len = 0; this.target = 4800; }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const L = input[0], R = input[1] || input[0];
    const out = new Int16Array(L.length * 2);
    let sum = 0;
    for (let i = 0; i < L.length; i++) {
      const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
      out[i * 2] = l * 32767; out[i * 2 + 1] = r * 32767;
      sum += l * l + r * r;
    }
    this.buf.push(out); this.len += L.length; this.sum = (this.sum || 0) + sum; this.n = (this.n || 0) + L.length * 2;
    if (this.len >= this.target) {
      const merged = new Int16Array(this.len * 2); let o = 0;
      for (const b of this.buf) { merged.set(b, o); o += b.length; }
      const rms = Math.sqrt(this.sum / Math.max(1, this.n));
      const db = rms > 0 ? 20 * Math.log10(rms) : -100;
      this.port.postMessage({ pcm: merged.buffer, db }, [merged.buffer]);
      this.buf = []; this.len = 0; this.sum = 0; this.n = 0;
    }
    return true;
  }
}
registerProcessor('pcm-sender', PcmSender);
