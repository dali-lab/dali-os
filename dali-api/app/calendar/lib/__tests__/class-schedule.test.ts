import { describe, it, expect } from "vitest";
import {
  classRRule,
  expandClassOccurrences,
  firstOccurrenceRange,
  resolveClassMeetings,
} from "../class-schedule";
import { getPeriod, periodMeetings } from "../dartmouth-periods";

// Fall-term anchors. 2026-09-14 is a Monday; 09-16 Wed, 09-17 Thu, 09-18 Fri.
// September is EDT (UTC-4), so 10:10 ET == 14:10 UTC.
const TERM_START = new Date("2026-09-14T12:00:00.000Z");
const TERM_END = new Date("2026-11-24T12:00:00.000Z");

describe("resolveClassMeetings", () => {
  it("resolves from a period code with the x-hour opt-in", () => {
    expect(resolveClassMeetings({ periodCode: "10", includeXHour: false })).toHaveLength(1);
    expect(resolveClassMeetings({ periodCode: "10", includeXHour: true })).toHaveLength(2);
  });
  it("passes custom meetings through", () => {
    const custom = [{ kind: "main" as const, days: [1], startMin: 600, endMin: 660 }];
    expect(resolveClassMeetings({ custom })).toBe(custom);
  });
});

describe("firstOccurrenceRange", () => {
  it("lands the 10-hour's first meeting on the term's opening Monday at 10:10 ET", () => {
    const main = getPeriod("10")!.main;
    const { startIso, endIso } = firstOccurrenceRange(main, TERM_START);
    expect(startIso).toBe("2026-09-14T14:10:00.000Z"); // Mon 10:10 EDT
    expect(endIso).toBe("2026-09-14T15:15:00.000Z"); // 11:15 EDT
  });

  it("skips ahead to the first matching weekday for a TuTh block", () => {
    const main = getPeriod("10A")!.main; // TuTh
    const { startIso } = firstOccurrenceRange(main, TERM_START); // term opens Mon
    // First Tuesday after Mon 09-14 is 09-15, 10:10 EDT = 14:10Z.
    expect(startIso).toBe("2026-09-15T14:10:00.000Z");
  });
});

describe("classRRule", () => {
  it("builds a weekly BYDAY rule bounded to the term end", () => {
    const main = getPeriod("10")!.main;
    expect(classRRule(main, TERM_END)).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261124T235959Z");
  });
});

describe("expandClassOccurrences", () => {
  const rangeStart = new Date("2026-09-14T00:00:00.000Z");
  const rangeEnd = new Date("2026-09-20T23:59:59.000Z"); // Mon–Sun opening week

  it("emits one occurrence per meeting day in range", () => {
    const occ = expandClassOccurrences(periodMeetings("10", false), TERM_START, TERM_END, rangeStart, rangeEnd);
    expect(occ).toHaveLength(3); // Mon/Wed/Fri
    expect(occ.every((o) => o.kind === "main")).toBe(true);
    expect(occ[0].startIso).toBe("2026-09-14T14:10:00.000Z");
  });

  it("includes the x-hour day when the x-hour is opted in", () => {
    const occ = expandClassOccurrences(periodMeetings("10", true), TERM_START, TERM_END, rangeStart, rangeEnd);
    expect(occ).toHaveLength(4); // + Thu x-hour
    expect(occ.filter((o) => o.kind === "xhour")).toHaveLength(1);
  });

  it("clips to the term window", () => {
    // A range entirely after the term end yields nothing.
    const after = expandClassOccurrences(
      periodMeetings("10", false),
      TERM_START,
      TERM_END,
      new Date("2026-12-01T00:00:00.000Z"),
      new Date("2026-12-07T00:00:00.000Z"),
    );
    expect(after).toHaveLength(0);
  });
});
