import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordCacheRead,
  recordDuration,
  reportPerfStats,
  sampleDuration,
} from "~/lib/perf-stats";

afterEach(() => {
  reportPerfStats(() => {});
  vi.restoreAllMocks();
});

function report(): string[] {
  const lines: string[] = [];
  reportPerfStats((line) => lines.push(line));
  return lines;
}

describe("perf stats", () => {
  it("reports percentiles for each named duration", () => {
    for (let ms = 1; ms <= 100; ms++) recordDuration("requireAuth", ms);
    expect(report()).toEqual(["[perf-stats] requireAuth n=100 p50=51ms p95=96ms max=100ms"]);
  });

  it("clears what it has reported", () => {
    recordDuration("requireAuth", 5);
    recordCacheRead("reference:Term", true);
    report();
    expect(report()).toEqual([]);
  });

  it("stops collecting a duration at the sample cap", () => {
    for (let i = 0; i < 5_001; i++) recordDuration("requireAuth", 1);
    expect(report()[0]).toContain("n=5000");
  });

  it("records the duration of a call that throws", async () => {
    await expect(
      sampleDuration("auth.legacy", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(report()[0]).toContain("auth.legacy n=1");
  });

  it("groups per-user cache keys by family", () => {
    recordCacheRead("layout:roles:u1:", true);
    recordCacheRead("layout:roles:u2:", true);
    recordCacheRead("layout:roles:u3:", true);
    recordCacheRead("layout:roles:u1:", false);
    recordCacheRead("reference:Term", false);
    expect(report()).toEqual([
      "[cache-stats] layout:roles hit=3 miss=1 rate=75%",
      "[cache-stats] reference:Term hit=0 miss=1 rate=0%",
    ]);
  });
});
