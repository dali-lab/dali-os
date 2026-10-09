// Pure audio-framing math shared by the capture pipeline. The AudioWorklet
// (worklet-processor.js) can't import this — AudioWorkletGlobalScope has no
// module loader for a plain `addModule(url)` — so it reimplements the same
// linear-interpolation downsample inline. These functions exist so that
// algorithm is covered by a unit test; keep the two in sync by eye if either
// changes.

export const SAMPLE_RATE = 16_000;
export const CHUNK_SECONDS = 20;
export const CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_SECONDS; // 320,000
export const CHUNK_BYTES = CHUNK_SAMPLES * 2; // 640,000 (Int16)

/** Average N channels of equal length into one. A single channel passes through. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length <= 1) return channels[0] ?? new Float32Array(0);
  const length = channels[0]!.length;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i] ?? 0;
    out[i] = sum / channels.length;
  }
  return out;
}

/**
 * Linear-interpolation resample. Not a brick-wall filter, but Parakeet runs
 * on 16kHz speech either way and this is cheap enough to run per 128-frame
 * render quantum in the worklet.
 */
export function downsample(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0]! * (1 - frac) + input[i1]! * frac;
  }
  return out;
}

/** [-1, 1] float samples to little-endian signed 16-bit PCM, clamped. */
export function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    view.setInt16(i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return buffer;
}
