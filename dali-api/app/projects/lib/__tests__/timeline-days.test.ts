import { describe, it, expect, afterEach } from "vitest";
import {
  DAY,
  utcDayStart,
  utcDayOf,
  localTodayUtcDay,
  dayOffset,
  daySpan,
  sprintBands,
  sprintBandsForSpan,
  SPRINT_DAYS,
} from "../timeline-days";

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("utcDayStart / utcDayOf", () => {
  it("is a fixed point on UTC midnight", () => {
    const t = Date.UTC(2026, 6, 20); // 2026-07-20T00:00:00Z
    expect(utcDayStart(t)).toBe(t);
    expect(utcDayOf("2026-07-20T00:00:00.000Z")).toBe(t);
  });

  it("floors mid-day instants to the same UTC day", () => {
    expect(utcDayOf("2026-07-20T23:59:59.999Z")).toBe(Date.UTC(2026, 6, 20));
    expect(utcDayOf("2026-07-20T00:00:00.001Z")).toBe(Date.UTC(2026, 6, 20));
  });

  it("does not shift with the local timezone (the bug this replaces)", () => {
    // Under local startOfDay in America/New_York, a UTC-midnight instant
    // landed on the *previous* local day, drawing bars a day early.
    process.env.TZ = "America/New_York";
    expect(utcDayOf("2026-07-20T00:00:00.000Z")).toBe(Date.UTC(2026, 6, 20));
    process.env.TZ = "Pacific/Auckland";
    expect(utcDayOf("2026-07-20T00:00:00.000Z")).toBe(Date.UTC(2026, 6, 20));
  });
});

describe("dayOffset", () => {
  it("maps an ISO date to its column index from the range start", () => {
    const min = Date.UTC(2026, 6, 1);
    expect(dayOffset("2026-07-01T00:00:00.000Z", min)).toBe(0);
    // July 20 must land on the column whose header prints "20" (index 19).
    expect(dayOffset("2026-07-20T00:00:00.000Z", min)).toBe(19);
    expect(dayOffset("2026-08-01T00:00:00.000Z", min)).toBe(31);
  });

  it("is timezone-independent", () => {
    const min = Date.UTC(2026, 6, 1);
    process.env.TZ = "America/Los_Angeles";
    expect(dayOffset("2026-07-20T00:00:00.000Z", min)).toBe(19);
  });
});

describe("daySpan", () => {
  it("is inclusive of both endpoints", () => {
    expect(daySpan("2026-07-20T00:00:00.000Z", "2026-07-20T00:00:00.000Z")).toBe(1);
    expect(daySpan("2026-07-01T00:00:00.000Z", "2026-07-14T00:00:00.000Z")).toBe(14);
  });

  it("spans month boundaries", () => {
    expect(daySpan("2026-06-29T00:00:00.000Z", "2026-07-02T00:00:00.000Z")).toBe(4);
  });
});

describe("localTodayUtcDay", () => {
  it("keys the local calendar date, not the UTC one", () => {
    // 2026-07-20T01:00Z is still the evening of July 19 in New York.
    const now = new Date("2026-07-20T01:00:00.000Z");
    process.env.TZ = "America/New_York";
    expect(localTodayUtcDay(now)).toBe(Date.UTC(2026, 6, 19));
    process.env.TZ = "UTC";
    expect(localTodayUtcDay(now)).toBe(Date.UTC(2026, 6, 20));
  });

  it("returns a UTC midnight", () => {
    expect(localTodayUtcDay() % DAY).toBe(0);
  });
});

describe("sprintBands", () => {
  // Stand-in for the component's UTC-pinned day formatter.
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  const day = (y: number, m: number, d: number) => Date.UTC(y, m, d);

  const fallTerm = {
    code: "26F",
    startsAt: "2026-09-14T00:00:00.000Z", // a Monday
    endsAt: "2026-11-22T00:00:00.000Z",
  };

  it("tiles the range in fixed one-week bands", () => {
    const bands = sprintBands(day(2026, 8, 14), day(2026, 9, 11), [fallTerm], fmt);
    expect(bands).toHaveLength(4);
    for (const b of bands) {
      expect((b.end - b.key) / DAY + 1).toBe(SPRINT_DAYS);
    }
    expect(bands[1]!.key - bands[0]!.key).toBe(SPRINT_DAYS * DAY);
  });

  it("anchors to the term start, not to the range start", () => {
    // Range opens mid-week; bands must still land on the term's Monday.
    const bands = sprintBands(day(2026, 8, 16), day(2026, 9, 11), [fallTerm], fmt);
    const termStart = day(2026, 8, 14);
    for (const b of bands) {
      expect((b.key - termStart) % (SPRINT_DAYS * DAY)).toBe(0);
    }
  });

  it("steps backwards to cover a range starting before the term", () => {
    const min = day(2026, 7, 24); // three weeks before the term opens
    const bands = sprintBands(min, day(2026, 8, 27), [fallTerm], fmt);
    expect(bands[0]!.key).toBeLessThanOrEqual(min);
    // Only the first band may start before `min`, and by less than a full week.
    expect(min - bands[0]!.key).toBeLessThan(SPRINT_DAYS * DAY);
  });

  it("labels bands with the term code and a running letter", () => {
    const bands = sprintBands(day(2026, 8, 14), day(2026, 9, 11), [fallTerm], fmt);
    expect(bands.map((b) => b.label)).toEqual([
      "Sprint 26FA",
      "Sprint 26FB",
      "Sprint 26FC",
      "Sprint 26FD",
    ]);
  });

  it("falls back to a week-of label outside every term", () => {
    const bands = sprintBands(day(2026, 7, 24), day(2026, 8, 20), [fallTerm], fmt);
    // Pre-term weeks get week-of labels; the term's own weeks get letters.
    expect(bands[0]!.label).toMatch(/^Wk of /);
    expect(bands.some((b) => b.label === "Sprint 26FA")).toBe(true);
  });

  it("restarts lettering per term", () => {
    const winter = {
      code: "27W",
      startsAt: "2027-01-04T00:00:00.000Z",
      endsAt: "2027-03-14T00:00:00.000Z",
    };
    const bands = sprintBands(day(2026, 8, 14), day(2027, 0, 17), [fallTerm, winter], fmt);
    const labels = bands.map((b) => b.label);
    expect(labels).toContain("Sprint 26FA");
    expect(labels).toContain("Sprint 27WA");
    expect(labels).toContain("Sprint 27WB");
  });

  it("numbers past the 26th week rather than running off the alphabet", () => {
    const longTerm = {
      code: "26X",
      startsAt: "2026-01-05T00:00:00.000Z",
      endsAt: "2026-12-28T00:00:00.000Z", // ~51 weeks
    };
    const bands = sprintBands(day(2026, 0, 5), day(2026, 11, 28), [longTerm], fmt);
    expect(bands[25]!.label).toBe("Sprint 26XZ");
    expect(bands[26]!.label).toBe("Sprint 26X·27");
  });

  it("uses the range start as the anchor when the project has no terms", () => {
    const min = day(2026, 8, 16);
    const bands = sprintBands(min, day(2026, 9, 11), [], fmt);
    expect(bands[0]!.key).toBe(min);
    expect(bands.every((b) => b.label.startsWith("Wk of "))).toBe(true);
  });

  it("clamps the final band to the range end", () => {
    const max = day(2026, 8, 17); // mid-week
    const bands = sprintBands(day(2026, 8, 14), max, [fallTerm], fmt);
    expect(bands.at(-1)!.end).toBe(max);
  });
});

describe("sprintBandsForSpan", () => {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  const fallTerm = {
    code: "26F",
    startsAt: "2026-09-14T00:00:00.000Z", // a Monday
    endsAt: "2026-11-22T00:00:00.000Z",
  };
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString();

  it("keeps the term-positional label rather than restarting at A", () => {
    // Sep 28 opens the term's third week, so it must read C — tiling from the
    // span alone would call it A.
    const bands = sprintBandsForSpan(iso(2026, 8, 28), iso(2026, 9, 6), [fallTerm], fmt);
    expect(bands.map((b) => b.label)).toEqual(["Sprint 26FC", "Sprint 26FD"]);
  });

  it("returns the single band a span inside one week sits in", () => {
    const bands = sprintBandsForSpan(iso(2026, 8, 15), iso(2026, 8, 17), [fallTerm], fmt);
    expect(bands.map((b) => b.label)).toEqual(["Sprint 26FA"]);
  });

  it("covers every week a long span touches", () => {
    const bands = sprintBandsForSpan(iso(2026, 8, 14), iso(2026, 9, 5), [fallTerm], fmt);
    expect(bands).toHaveLength(4);
    expect(bands[0]!.label).toBe("Sprint 26FA");
    expect(bands.at(-1)!.label).toBe("Sprint 26FD");
  });

  it("is empty when the span runs backwards", () => {
    expect(sprintBandsForSpan(iso(2026, 8, 20), iso(2026, 8, 14), [fallTerm], fmt)).toEqual(
      [],
    );
  });

  it("falls back to week-of labels outside every term", () => {
    const bands = sprintBandsForSpan(iso(2026, 5, 1), iso(2026, 5, 3), [fallTerm], fmt);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.label).toMatch(/^Wk of /);
  });
});
