import { describe, expect, it } from "vitest";
import { CHUNK_BYTES, CHUNK_SAMPLES, downsample, floatTo16BitPCM, mixToMono } from "./pcm";

describe("mixToMono", () => {
  it("passes a single channel through unchanged", () => {
    const ch = new Float32Array([0.1, 0.2, -0.3]);
    expect(mixToMono([ch])).toBe(ch);
  });

  it("averages two channels sample by sample", () => {
    const left = new Float32Array([1, 0, -1]);
    const right = new Float32Array([0, 1, 1]);
    expect(Array.from(mixToMono([left, right]))).toEqual([0.5, 0.5, 0]);
  });
});

describe("downsample", () => {
  it("returns the input unchanged when rates match", () => {
    const input = new Float32Array([1, 2, 3]);
    expect(downsample(input, 16_000, 16_000)).toBe(input);
  });

  it("halves the length at a 2:1 ratio", () => {
    const input = new Float32Array(100).map((_, i) => i);
    const out = downsample(input, 32_000, 16_000);
    expect(out.length).toBe(50);
  });

  it("interpolates linearly between samples", () => {
    // 4:1 ratio, ramp input — output[1] should sit at input index 4, i.e. value 4.
    const input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const out = downsample(input, 32_000, 8_000);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(4, 5);
  });
});

describe("floatTo16BitPCM", () => {
  it("round-trips full-scale and zero samples as little-endian Int16", () => {
    const input = new Float32Array([0, 1, -1, 0.5, -0.5]);
    const buffer = floatTo16BitPCM(input);
    const view = new DataView(buffer);
    expect(buffer.byteLength).toBe(input.length * 2);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(0x7fff);
    expect(view.getInt16(4, true)).toBe(-0x8000);
    expect(view.getInt16(6, true)).toBeCloseTo(0x3fff, -1);
  });

  it("clamps out-of-range samples instead of wrapping", () => {
    const buffer = floatTo16BitPCM(new Float32Array([2, -2]));
    const view = new DataView(buffer);
    expect(view.getInt16(0, true)).toBe(0x7fff);
    expect(view.getInt16(2, true)).toBe(-0x8000);
  });
});

describe("chunk framing constants", () => {
  it("20 seconds at 16kHz mono Int16 is 640,000 bytes", () => {
    expect(CHUNK_SAMPLES).toBe(320_000);
    expect(CHUNK_BYTES).toBe(640_000);
  });
});
