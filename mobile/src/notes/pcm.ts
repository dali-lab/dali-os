// Same framing as the web recorder (dali-api/app/components/meeting-recorder/pcm.ts):
// 16kHz mono signed 16-bit little-endian PCM, uploaded in 20s chunks.

export const SAMPLE_RATE = 16_000;
export const CHUNK_SECONDS = 20;
export const CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_SECONDS;

/** Interleaved float samples to one channel by averaging. */
export function mixToMono(samples: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return samples;
  const out = new Float32Array(Math.floor(samples.length / channels));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += samples[i * channels + c];
    out[i] = sum / channels;
  }
  return out;
}

/** Linear-interpolation resample; the device may not deliver 16kHz even when asked. */
export function downsample(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Root-mean-square loudness, 0..1. */
export function level(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length));
}

/** Collects 16kHz float samples and hands back full chunks as s16le PCM. */
export class ChunkAssembler {
  private buffer = new Int16Array(CHUNK_SAMPLES);
  private filled = 0;

  push(samples: Float32Array): ArrayBuffer[] {
    const out: ArrayBuffer[] = [];
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      this.buffer[this.filled++] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
      if (this.filled === CHUNK_SAMPLES) {
        out.push(this.buffer.buffer.slice(0));
        this.filled = 0;
      }
    }
    return out;
  }

  /** The partial chunk, or null when nothing is buffered. Resets the assembler. */
  flush(): ArrayBuffer | null {
    if (this.filled === 0) return null;
    const rest = this.buffer.buffer.slice(0, this.filled * 2);
    this.filled = 0;
    return rest;
  }
}
