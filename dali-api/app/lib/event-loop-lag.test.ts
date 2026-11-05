import { describe, it, expect, vi } from "vitest";
import type { IntervalHistogram } from "node:perf_hooks";
import { watchEventLoopLag } from "./event-loop-lag.server";

const MS = 1_000_000;

function fakeHistogram(maxMs: number, p99Ms: number) {
  return {
    max: maxMs * MS,
    percentile: () => p99Ms * MS,
    enable: vi.fn(),
    reset: vi.fn(),
  } as unknown as IntervalHistogram;
}

describe("watchEventLoopLag", () => {
  it("logs the worst lag once it reaches 100ms", () => {
    const log = vi.fn();
    watchEventLoopLag({ histogram: fakeHistogram(2400, 310), log })();
    expect(log).toHaveBeenCalledWith("[event-loop] maxLag=2400ms p99=310ms");
  });

  it("stays quiet below 100ms", () => {
    const log = vi.fn();
    watchEventLoopLag({ histogram: fakeHistogram(99, 20), log })();
    expect(log).not.toHaveBeenCalled();
  });

  it("starts measuring and clears after each report", () => {
    const histogram = fakeHistogram(10, 1);
    const report = watchEventLoopLag({ histogram, log: vi.fn() });
    expect(histogram.enable).toHaveBeenCalledTimes(1);
    report();
    expect(histogram.reset).toHaveBeenCalledTimes(1);
  });
});
