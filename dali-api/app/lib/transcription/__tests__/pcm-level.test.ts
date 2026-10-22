import { describe, it, expect } from "vitest";
import { isVoiced } from "~/lib/transcription/pcm-level";

const pcm = (sample: (i: number) => number, samples = 16_000) => {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(sample(i), i * 2);
  return buf;
};

describe("isVoiced", () => {
  it("is false for digital silence", () => {
    expect(isVoiced(pcm(() => 0))).toBe(false);
  });

  it("is false for a faint noise floor", () => {
    expect(isVoiced(pcm((i) => (i % 2 ? 40 : -40)))).toBe(false);
  });

  it("is true for speech-level audio", () => {
    expect(isVoiced(pcm((i) => Math.round(3000 * Math.sin(i / 5))))).toBe(true);
  });

  it("is true when a short burst of speech sits in an otherwise silent chunk", () => {
    expect(isVoiced(pcm((i) => (i < 1_600 ? Math.round(3000 * Math.sin(i / 5)) : 0)))).toBe(true);
  });

  it("is false for an empty buffer", () => {
    expect(isVoiced(Buffer.alloc(0))).toBe(false);
  });

  it("ignores a trailing odd byte", () => {
    expect(isVoiced(Buffer.concat([pcm(() => 0, 10), Buffer.from([0x7f])]))).toBe(false);
  });
});
