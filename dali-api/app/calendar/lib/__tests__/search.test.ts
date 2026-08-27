import { describe, it, expect } from "vitest";
import { searchWindow, sortHits, SEARCH_NEAR_PAD_MS, type CalendarSearchHit } from "../search";

const hit = (id: string, startIso: string): CalendarSearchHit => ({
  id,
  source: "google",
  title: id,
  startIso,
  endIso: startIso,
  allDay: false,
  location: null,
  recurring: false,
});

describe("searchWindow", () => {
  const now = "2026-08-20T12:00:00.000Z";
  const rangeStart = "2026-08-17T00:00:00.000Z";
  const rangeEnd = "2026-08-24T00:00:00.000Z";

  it("near pads the current view by two weeks each side", () => {
    const { start, end } = searchWindow("near", rangeStart, rangeEnd, now);
    expect(start.getTime()).toBe(new Date(rangeStart).getTime() - SEARCH_NEAR_PAD_MS);
    expect(end.getTime()).toBe(new Date(rangeEnd).getTime() + SEARCH_NEAR_PAD_MS);
  });

  it("all opens a wide window centered on now", () => {
    const { start, end } = searchWindow("all", rangeStart, rangeEnd, now);
    const nowMs = new Date(now).getTime();
    expect(start.getTime()).toBeLessThan(nowMs);
    expect(end.getTime()).toBeGreaterThan(nowMs);
    // Much wider than the near window (years, not weeks).
    expect(end.getTime() - start.getTime()).toBeGreaterThan(3 * 365 * 86_400_000);
  });
});

describe("sortHits", () => {
  const now = "2026-08-20T12:00:00.000Z";

  it("orders upcoming soonest-first, then past most-recent-first", () => {
    const hits = [
      hit("pastOld", "2026-08-01T09:00:00.000Z"),
      hit("futureLate", "2026-09-10T09:00:00.000Z"),
      hit("pastRecent", "2026-08-18T09:00:00.000Z"),
      hit("futureSoon", "2026-08-22T09:00:00.000Z"),
    ];
    expect(sortHits(hits, now).map((h) => h.id)).toEqual([
      "futureSoon",
      "futureLate",
      "pastRecent",
      "pastOld",
    ]);
  });

  it("treats an event starting exactly now as upcoming", () => {
    const hits = [hit("past", "2026-08-19T12:00:00.000Z"), hit("nowish", now)];
    expect(sortHits(hits, now).map((h) => h.id)).toEqual(["nowish", "past"]);
  });

  it("does not mutate the input array", () => {
    const hits = [hit("b", "2026-09-01T00:00:00.000Z"), hit("a", "2026-08-25T00:00:00.000Z")];
    const copy = [...hits];
    sortHits(hits, now);
    expect(hits).toEqual(copy);
  });
});
