// AudioWorkletProcessor for meeting-recording capture. Runs in
// AudioWorkletGlobalScope, which has no module loader for a plain
// addModule(url) across every supported browser, so this file is
// self-contained vanilla JS with no imports — it can't reuse
// ../meeting-recorder/pcm.ts. It mirrors that module's downsample +
// floatTo16BitPCM math inline (see pcm.ts's header comment for the other
// half of this split and pcm.test.ts for the algorithm under test).
//
// Mixes every input channel to mono, resamples to 16kHz via linear
// interpolation carried across process() calls (each call is one 128-sample
// render quantum, far short of a resample ratio's cycle), and buffers until
// it has a full 20s frame (320,000 samples / 640,000 bytes), then posts the
// Int16 buffer as a transferable ArrayBuffer. A "flush" message (sent right
// before the track stops) posts whatever's buffered, even partial.

const OUTPUT_RATE = 16000;
const FRAME_SAMPLES = OUTPUT_RATE * 20;

class PcmDownsampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME_SAMPLES);
    this.bufferLen = 0;
    // Fractional position in the current render quantum's input stream,
    // carried across calls so the resample ratio doesn't reset every 128
    // samples.
    this.resamplePos = 0;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "flush") {
        this.emit();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || input[0].length === 0) return true;
    const length = input[0].length;
    const channelCount = input.length;
    // `sampleRate` is a global in AudioWorkletGlobalScope: the AudioContext's
    // rate (the device rate, typically 44100 or 48000).
    const ratio = sampleRate / OUTPUT_RATE;

    let pos = this.resamplePos;
    while (pos < length) {
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, length - 1);
      const frac = pos - i0;
      let s0 = 0;
      let s1 = 0;
      for (let c = 0; c < channelCount; c++) {
        s0 += input[c][i0];
        s1 += input[c][i1];
      }
      s0 /= channelCount;
      s1 /= channelCount;
      this.buffer[this.bufferLen++] = s0 * (1 - frac) + s1 * frac;
      if (this.bufferLen === FRAME_SAMPLES) this.emit();
      pos += ratio;
    }
    this.resamplePos = pos - length;
    return true;
  }

  emit() {
    const len = this.bufferLen;
    if (len === 0) return;
    const out = new ArrayBuffer(len * 2);
    const view = new DataView(out);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, this.buffer[i]));
      view.setInt16(i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
    }
    this.port.postMessage({ type: "frame", buffer: out, samples: len }, [out]);
    this.bufferLen = 0;
  }
}

registerProcessor("pcm-downsample-processor", PcmDownsampleProcessor);
