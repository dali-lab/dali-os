import { describe, it, expect } from "vitest";
import {
  DARTMOUTH_PERIODS,
  getPeriod,
  periodMeetings,
  rruleByDay,
  weekdayLabel,
  periodSummary,
} from "../dartmouth-periods";

describe("dartmouth periods", () => {
  it("resolves the 10 hour to MWF 10:10–11:15 with a Thu x-hour", () => {
    const p = getPeriod("10")!;
    expect(p.main.days).toEqual([1, 3, 5]); // Mon/Wed/Fri
    expect(p.main.startMin).toBe(10 * 60 + 10); // 10:10
    expect(p.main.endMin).toBe(11 * 60 + 15); // 11:15
    expect(p.xhour!.days).toEqual([4]); // Thu
    expect(p.xhour!.startMin).toBe(12 * 60 + 15); // 12:15 PM
    expect(p.xhour!.endMin).toBe(13 * 60 + 5); // 1:05 PM
  });

  it("resolves the 10A block to TuTh 10:10–12:00", () => {
    const p = getPeriod("10A")!;
    expect(p.main.days).toEqual([2, 4]);
    expect(p.main.startMin).toBe(10 * 60 + 10);
    expect(p.main.endMin).toBe(12 * 60);
  });

  it("includes the x-hour meeting only when opted in", () => {
    expect(periodMeetings("10", false)).toHaveLength(1);
    const both = periodMeetings("10", true);
    expect(both).toHaveLength(2);
    expect(both[0].kind).toBe("main");
    expect(both[1].kind).toBe("xhour");
  });

  it("returns nothing for an unknown period", () => {
    expect(getPeriod("ARR")).toBeUndefined();
    expect(periodMeetings("ARR", true)).toEqual([]);
  });

  it("maps weekdays to RRULE BYDAY and a readable label", () => {
    expect(rruleByDay([1, 3, 5])).toBe("MO,WE,FR");
    expect(rruleByDay([2, 4])).toBe("TU,TH");
    expect(weekdayLabel([1, 3, 5])).toBe("MWF");
  });

  it("has valid, ordered time ranges for every period", () => {
    for (const p of DARTMOUTH_PERIODS) {
      for (const mtg of [p.main, p.xhour!].filter(Boolean)) {
        expect(mtg.days.length).toBeGreaterThan(0);
        expect(mtg.startMin).toBeGreaterThanOrEqual(0);
        expect(mtg.endMin).toBeLessThanOrEqual(24 * 60);
        expect(mtg.endMin).toBeGreaterThan(mtg.startMin);
      }
    }
  });

  it("produces a picker summary", () => {
    expect(periodSummary(getPeriod("10")!)).toBe("10 · MWF 10:10 AM–11:15 AM (x-hr Th)");
  });
});
