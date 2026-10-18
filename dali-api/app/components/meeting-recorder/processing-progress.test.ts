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

  it("fetching: parts done of total, weighted 10% of the channel", () => {
    const d = describeProcessing("fetching", progress({ stage: "fetching", completed: 3, total: 12 }));
    expect(d.title).toBe("Preparing audio");
    expect(d.detail).toBe("3 of 12 parts");
    expect(d.fraction).toBeCloseTo(0.025);
    expect(d.pillLabel).toBe("Transcribing");
  });

  it("transcribing: minutes scale with completed windows and the fraction starts after the fetch share", () => {
    const d = describeProcessing("transcribing", progress({ completed: 6 }));
    expect(d.title).toBe("Transcribing");
    expect(d.detail).toBe("29 of 58 min");
    expect(d.fraction).toBeCloseTo(0.1 + 0.6 * 0.5);
  });

  it("transcribing: minutes never exceed the audio length", () => {
    expect(describeProcessing("transcribing", progress({ completed: 12 })).detail).toBe("58 of 58 min");
    expect(describeProcessing("transcribing", progress({ completed: 1, total: 1, audioSeconds: 120 })).detail).toBe("2 of 2 min");
  });

  it("transcribing: under a minute of audio says so", () => {
    expect(describeProcessing("transcribing", progress({ completed: 0, total: 1, audioSeconds: 40 })).detail).toBe("Under a minute");
  });

  it("transcribing: exactly a minute of audio reads as one minute", () => {
    expect(describeProcessing("transcribing", progress({ completed: 0, total: 1, audioSeconds: 60 })).detail).toBe("0 of 1 min");
  });

  it("labeling: percent from the batch fraction, Labeling pill, last 30% of the channel", () => {
    const d = describeProcessing("labeling", progress({ stage: "labeling", completed: 33, total: 100 }));
    expect(d.title).toBe("Labeling speakers");
    expect(d.detail).toBe("Finding who spoke when · 33%");
    expect(d.fraction).toBeCloseTo(0.7 + 0.3 * 0.33);
    expect(d.pillLabel).toBe("Labeling");
  });

  it("a zero total reads as no progress instead of dividing by zero", () => {
    expect(describeProcessing("labeling", progress({ stage: "labeling", completed: 0, total: 0 })).fraction).toBeCloseTo(0.7);
  });

  it("names the channel only when there is more than one", () => {
    expect(describeProcessing("transcribing", progress({ channels: 1 })).detail).not.toContain("channel");
    const d = describeProcessing("transcribing", progress({ channel: 2, channels: 2, completed: 6 }));
    expect(d.detail).toBe("29 of 58 min · channel 2 of 2");
  });

  it("never moves backwards when the second channel starts", () => {
    const end1 = describeProcessing("labeling", progress({ stage: "labeling", channel: 1, channels: 2, completed: 100, total: 100 })).fraction;
    const start2 = describeProcessing("fetching", progress({ stage: "fetching", channel: 2, channels: 2, completed: 0, total: 5 })).fraction;
    expect(end1).toBeCloseTo(0.5);
    expect(start2).toBeCloseTo(0.5);
    const mid2 = describeProcessing("transcribing", progress({ channel: 2, channels: 2, completed: 6 })).fraction;
    expect(mid2).toBeGreaterThan(start2);
    expect(describeProcessing("labeling", progress({ stage: "labeling", channel: 2, channels: 2, completed: 5, total: 5 })).fraction).toBe(1);
  });
});
