import { describe, it, expect } from "vitest";
import {
  slotIsFree,
  candidateSlots,
  rankSlots,
  findOptimalSlots,
  type MsInterval,
} from "~/calendar/lib/optimal-times";

const HOUR = 3_600_000;
const iv = (startMs: number, endMs: number): MsInterval => ({ startMs, endMs });

describe("slotIsFree", () => {
  it("is true when one interval fully covers the slot", () => {
    expect(slotIsFree([iv(0, 4 * HOUR)], HOUR, 2 * HOUR)).toBe(true);
  });

  it("is false when the slot pokes past the free interval", () => {
    expect(slotIsFree([iv(0, HOUR)], 0, 2 * HOUR)).toBe(false);
  });

  it("covers a slot spanning two back-to-back free intervals (union)", () => {
    expect(slotIsFree([iv(0, HOUR), iv(HOUR, 3 * HOUR)], 0, 2 * HOUR)).toBe(true);
  });

  it("is false when there's a gap between the free intervals", () => {
    // Free 0–1h and 2–3h, but the slot 0–2h needs the 1–2h gap.
    expect(slotIsFree([iv(0, HOUR), iv(2 * HOUR, 3 * HOUR)], 0, 2 * HOUR)).toBe(false);
  });

  it("is false with no free time at all", () => {
    expect(slotIsFree([], 0, HOUR)).toBe(false);
  });
});

describe("candidateSlots", () => {
  it("steps starts across the band and stops so the meeting ends within it", () => {
    // One day, band 9–11, 30-min step, 60-min meeting → starts 9:00, 9:30, 10:00.
    const day0 = 0;
    const slots = candidateSlots([day0], 9, 11, 30, 60);
    expect(slots.map((s) => s.startMs / HOUR)).toEqual([9, 9.5, 10]);
    expect(slots.every((s) => s.endMs - s.startMs === HOUR)).toBe(true);
    // Last one ends exactly at the band edge (11:00), none spill past it.
    expect(Math.max(...slots.map((s) => s.endMs))).toBe(11 * HOUR);
  });

  it("emits candidates per day, anchored to each day's local midnight", () => {
    const day = 24 * HOUR;
    const slots = candidateSlots([0, day], 9, 10, 60, 60);
    expect(slots).toHaveLength(2);
    expect(slots[0].startMs).toBe(9 * HOUR);
    expect(slots[1].startMs).toBe(day + 9 * HOUR);
  });
});

describe("rankSlots", () => {
  it("orders by free count desc, then earliest, and returns the count", () => {
    const cands = [iv(9 * HOUR, 10 * HOUR), iv(11 * HOUR, 12 * HOUR)];
    // Two people free at 11, only one free at 9 → 11 ranks first.
    const perUserFree = [
      [iv(11 * HOUR, 12 * HOUR)], // person A: free at 11 only
      [iv(9 * HOUR, 12 * HOUR)], // person B: free 9–12
    ];
    const ranked = rankSlots(cands, perUserFree, 5);
    expect(ranked[0]).toMatchObject({ startMs: 11 * HOUR, freeCount: 2 });
    expect(ranked[1]).toMatchObject({ startMs: 9 * HOUR, freeCount: 1 });
  });

  it("drops slots nobody is free for", () => {
    const cands = [iv(9 * HOUR, 10 * HOUR)];
    const ranked = rankSlots(cands, [[iv(20 * HOUR, 21 * HOUR)]], 5);
    expect(ranked).toHaveLength(0);
  });

  it("keeps distinct, non-overlapping suggestions instead of adjacent clones", () => {
    // Three overlapping candidate windows, everyone free across the whole span.
    const cands = [
      iv(9 * HOUR, 10 * HOUR),
      iv(9.25 * HOUR, 10.25 * HOUR), // overlaps the first
      iv(11 * HOUR, 12 * HOUR), // separate
    ];
    const perUserFree = [[iv(9 * HOUR, 12 * HOUR)]];
    const ranked = rankSlots(cands, perUserFree, 5);
    // The 9:15 clone is dropped because it overlaps the kept 9:00 slot.
    expect(ranked.map((s) => s.startMs / HOUR)).toEqual([9, 11]);
  });

  it("caps the result count", () => {
    const cands = [0, 2, 4, 6, 8].map((h) => iv(h * HOUR, (h + 1) * HOUR));
    const ranked = rankSlots(cands, [[iv(0, 24 * HOUR)]], 3);
    expect(ranked).toHaveLength(3);
  });
});

describe("findOptimalSlots", () => {
  it("finds the fully-free slot across a day for a set of participants", () => {
    // Two people: A busy 9–10, B busy 10–11. The only hour both are free in
    // 9–12 is 11–12.
    const perUserFree = [
      [iv(10 * HOUR, 13 * HOUR)], // A free from 10
      [iv(9 * HOUR, 10 * HOUR), iv(11 * HOUR, 13 * HOUR)], // B free 9–10 and 11+
    ];
    const best = findOptimalSlots({
      dayStartMs: [0],
      perUserFree,
      bandStartHour: 9,
      bandEndHour: 13,
      stepMinutes: 60,
      durationMinutes: 60,
      maxResults: 5,
    });
    expect(best[0]).toMatchObject({ startMs: 11 * HOUR, freeCount: 2 });
  });
});
