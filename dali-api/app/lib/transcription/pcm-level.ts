// Silent system audio (an in-person meeting on the desktop app) is digital
// zero, and transcribing it costs the same GPU time as speech. About -50 dBFS
// RMS: well below speech spread across a 20s chunk, well above zero.
const SILENCE_RMS = 100;

/** Whether a 16-bit little-endian mono PCM chunk carries any sound. */
export function isVoiced(pcm: Buffer): boolean {
  const samples = Math.floor(pcm.byteLength / 2);
  if (samples === 0) return false;
  let sumSquares = 0;
  for (let i = 0; i < samples; i++) {
    const s = pcm.readInt16LE(i * 2);
    sumSquares += s * s;
  }
  return Math.sqrt(sumSquares / samples) > SILENCE_RMS;
}
