import { describe, it, expect } from "vitest";
import { ALL_LAB, dropOrder, matchesDomainFilter, termWeek } from "~/core/lib/milestones";

describe("termWeek", () => {
  const start = new Date("2026-09-14T00:00:00Z");
  const day = (n: number) => new Date(start.getTime() + n * 86_400_000);

  it("is week 0 before the term starts", () => {
    expect(termWeek(start, day(-3))).toBe(0);
  });

  it("counts the first seven days as week 1", () => {
    expect(termWeek(start, day(0))).toBe(1);
    expect(termWeek(start, day(6))).toBe(1);
    expect(termWeek(start, day(7))).toBe(2);
  });

  it("stays on week 10 through finals", () => {
    expect(termWeek(start, day(80))).toBe(10);
  });
});

describe("matchesDomainFilter", () => {
  it("shows everything with no filter", () => {
    expect(matchesDomainFilter([], [])).toBe(true);
    expect(matchesDomainFilter(["dev"], [])).toBe(true);
  });

  it("matches a milestone carrying any picked domain", () => {
    expect(matchesDomainFilter(["dev", "design"], ["design"])).toBe(true);
    expect(matchesDomainFilter(["dev"], ["design"])).toBe(false);
  });

  it("shows lab-wide milestones only when All lab is picked", () => {
    expect(matchesDomainFilter([], ["design"])).toBe(false);
    expect(matchesDomainFilter([], ["design", ALL_LAB])).toBe(true);
    expect(matchesDomainFilter(["dev"], [ALL_LAB])).toBe(false);
  });
});

describe("dropOrder", () => {
  it("lands after the card under the pointer when dragging down", () => {
    expect(dropOrder(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(dropOrder(["a", "b", "c"], "a", "b")).toEqual(["b", "a", "c"]);
  });

  it("lands before the card under the pointer when dragging up", () => {
    expect(dropOrder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("inserts before the card under the pointer when coming from another column", () => {
    expect(dropOrder(["a", "b"], "x", "b")).toEqual(["a", "x", "b"]);
  });

  it("appends when dropped on the column itself", () => {
    expect(dropOrder(["a", "b"], "x", null)).toEqual(["a", "b", "x"]);
    expect(dropOrder(["a", "b"], "a", null)).toEqual(["b", "a"]);
  });
});
