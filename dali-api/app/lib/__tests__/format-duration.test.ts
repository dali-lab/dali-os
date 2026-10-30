import { describe, it, expect } from "vitest";
import { formatDuration } from "~/lib/format-duration";

describe("formatDuration", () => {
  it.each([
    [null, "n/a"],
    [-1, "n/a"],
    [Number.NaN, "n/a"],
    [0, "0s"],
    [4_400, "4s"],
    [59_400, "59s"],
    [60_000, "1m"],
    [80_000, "1m 20s"],
    [30 * 60 * 1000, "30m"],
  ])("formats %s as %s", (ms, out) => {
    expect(formatDuration(ms)).toBe(out);
  });
});
