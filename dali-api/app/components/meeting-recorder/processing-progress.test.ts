import { describe, it, expect } from "vitest";
import { describeProcessing } from "./processing-progress";
import type { RecordingProgress } from "./types";

const progress = (extra: Partial<RecordingProgress>): RecordingProgress => ({
  stage: "transcribing",
  channel: 1,
  channels: 1,
  completed: 0,
  total: 12,
  audioSeconds: 3480,
  ...extra,
});

describe("describeProcessing", () => {
  it("starting: indeterminate, empty ring, Transcribing label", () => {
    expect(describeProcessing("starting", null)).toEqual({
      title: "Starting up",
      detail: "Getting the transcriber ready",
      fraction: 0,
      pillLabel: "Transcribing",
    });
  });

  it("fetching: parts done of total", () => {
    const d = describeProcessing("fetching", progress({ stage: "fetching", completed: 3, total: 12 }));
    expect(d.title).toBe("Preparing audio");
    expect(d.detail).toBe("3 of 12 parts");
    expect(d.fraction).toBe(0.25);
    expect(d.pillLabel).toBe("Transcribing");
  });

  it("transcribing: five minutes per completed window", () => {
    const d = describeProcessing("transcribing", progress({ completed: 7 }));
    expect(d.title).toBe("Transcribing");
    expect(d.detail).toBe("35 of 58 min");
    expect(d.fraction).toBeCloseTo(7 / 12);
  });

  it("transcribing: minutes never exceed the audio length", () => {
    expect(describeProcessing("transcribing", progress({ completed: 12 })).detail).toBe("58 of 58 min");
    expect(describeProcessing("transcribing", progress({ completed: 1, total: 1, audioSeconds: 120 })).detail).toBe("2 of 2 min");
  });

  it("labeling: percent from the batch fraction, Labeling pill", () => {
    const d = describeProcessing("labeling", progress({ stage: "labeling", completed: 33, total: 100 }));
    expect(d.title).toBe("Labeling speakers");
    expect(d.detail).toBe("Finding who spoke when · 33%");
    expect(d.fraction).toBe(0.33);
    expect(d.pillLabel).toBe("Labeling");
  });

  it("a zero total reads as no progress instead of dividing by zero", () => {
    expect(describeProcessing("labeling", progress({ stage: "labeling", completed: 0, total: 0 })).fraction).toBe(0);
  });
});
