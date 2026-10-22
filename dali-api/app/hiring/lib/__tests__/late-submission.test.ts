import { describe, expect, it } from "vitest";
import { formatLateBy, lateByLabel, lateByMs } from "~/hiring/lib/late-submission";

const close = new Date("2026-10-11T03:59:59.000Z");
const after = (ms: number) => new Date(close.getTime() + ms);

describe("lateByMs", () => {
  it("is null for a submission before the close", () => {
    expect(lateByMs(after(-60_000), close)).toBeNull();
  });

  it("is null exactly at the close", () => {
    expect(lateByMs(close, close)).toBeNull();
  });

  it("is the gap for a submission after the close", () => {
    expect(lateByMs(after(90_000), close)).toBe(90_000);
  });

  it("accepts ISO strings", () => {
    expect(lateByMs(after(5_000).toISOString(), close)).toBe(5_000);
  });

  it("is null with no submission or no deadline", () => {
    expect(lateByMs(null, close)).toBeNull();
    expect(lateByMs(after(5_000), null)).toBeNull();
  });
});

describe("formatLateBy", () => {
  it.each([
    [1_000, "Late by 1m"],
    [14 * 60_000, "Late by 14m"],
    [60 * 60_000, "Late by 1h"],
    [5.4 * 3_600_000, "Late by 5h"],
    [47 * 3_600_000, "Late by 47h"],
    [48 * 3_600_000, "Late by 2d"],
    [9.6 * 86_400_000, "Late by 10d"],
  ])("%d ms reads %s", (ms, label) => {
    expect(formatLateBy(ms)).toBe(label);
  });
});

describe("lateByLabel", () => {
  it("labels only late submissions", () => {
    expect(lateByLabel(after(3 * 3_600_000), close)).toBe("Late by 3h");
    expect(lateByLabel(after(-3 * 3_600_000), close)).toBeNull();
  });
});
