import { describe, expect, it } from "vitest";
import { defaultSpan, pickWeek, spanLabel } from "../week-pick";

describe("pickWeek", () => {
  it("the first click sets start and end to that week", () => {
    expect(pickWeek({ start: 1, end: 2, next: "start" }, 5)).toEqual({ start: 5, end: 5, next: "end" });
  });

  it("the second click makes a span in either direction", () => {
    expect(pickWeek({ start: 3, end: 3, next: "end" }, 6)).toEqual({ start: 3, end: 6, next: "start" });
    expect(pickWeek({ start: 6, end: 6, next: "end" }, 2)).toEqual({ start: 2, end: 6, next: "start" });
  });

  it("clicking the same week twice keeps a one week milestone", () => {
    expect(pickWeek({ start: 4, end: 4, next: "end" }, 4)).toEqual({ start: 4, end: 4, next: "start" });
  });

  it("the third click starts over", () => {
    const afterSpan = pickWeek(pickWeek({ start: 1, end: 1, next: "start" }, 2), 5);
    expect(pickWeek(afterSpan, 8)).toEqual({ start: 8, end: 8, next: "end" });
  });
});

describe("spanLabel and defaultSpan", () => {
  it("pluralises", () => {
    expect(spanLabel(3, 3)).toBe("1 week");
    expect(spanLabel(3, 6)).toBe("4 weeks");
  });

  it("defaults to the due week and the next, clamped to the period", () => {
    expect(defaultSpan(10, 8)).toEqual({ start: 8, end: 9 });
    expect(defaultSpan(10, 10)).toEqual({ start: 10, end: 10 });
  });

  it("falls back to the first two weeks", () => {
    expect(defaultSpan(10, null)).toEqual({ start: 1, end: 2 });
    expect(defaultSpan(10, 11)).toEqual({ start: 1, end: 2 });
    expect(defaultSpan(1, null)).toEqual({ start: 1, end: 1 });
  });
});
