import { describe, expect, it } from "vitest";
import { resolveViewed } from "../view";
import type { BoardPeriod } from "../weeks";

const periods: BoardPeriod[] = [
  { id: "f", name: "Fall", shortName: "26F", kind: "Term", startDate: "2026-09-13", weekCount: 10 },
];
const current = { periodId: "f", week: 8, between: false };

describe("resolveViewed", () => {
  it("defaults to the current week", () => {
    expect(resolveViewed(periods, current, null, null)).toEqual({ periodId: "f", week: 8 });
  });

  it("honors a valid period and week", () => {
    expect(resolveViewed(periods, current, "f", "3")).toEqual({ periodId: "f", week: 3 });
  });

  it.each([
    ["unknown period", "x", "3"],
    ["week below range", "f", "0"],
    ["week above range", "f", "11"],
    ["non-numeric week", "f", "abc"],
    ["decimal week", "f", "2.5"],
    ["missing week", "f", null],
  ])("falls back to current for %s", (_n, p, w) => {
    expect(resolveViewed(periods, current, p, w as string | null)).toEqual({ periodId: "f", week: 8 });
  });

  it("is null with no periods and no params", () => {
    expect(resolveViewed([], null, null, null)).toBeNull();
  });
});
