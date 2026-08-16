import { describe, expect, it } from "vitest";
import rrulePkg from "rrule";
import {
  MAX_REPEAT_COUNT,
  NO_REPEAT,
  repeatSpecToRRule,
  weekdayOf,
  type RepeatSpec,
} from "../RepeatField";

const { rrulestr } = rrulePkg as unknown as { rrulestr: typeof import("rrule").rrulestr };

const spec = (over: Partial<RepeatSpec>): RepeatSpec => ({ ...NO_REPEAT, ...over });

// The rule only means anything if the same expander the app uses
// (app/lib/meeting-occurrences.ts) reads it back the way the UI promised.
function occurrences(rule: string, dtstart: Date, limit = 40) {
  const parsed = rrulestr(
    `DTSTART:${dtstart.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z\nRRULE:${rule}`,
  );
  return parsed.all((_, i) => i < limit);
}

describe("repeatSpecToRRule", () => {
  it("emits nothing when it does not repeat", () => {
    expect(repeatSpecToRRule(NO_REPEAT)).toBeNull();
  });

  it("omits INTERVAL at the default of 1", () => {
    expect(repeatSpecToRRule(spec({ freq: "weekly" }))).toBe("FREQ=WEEKLY");
  });

  it("carries interval, selected weekdays, and a count", () => {
    const rule = repeatSpecToRRule(
      spec({ freq: "weekly", interval: 2, byDay: [1, 3, 4], end: { type: "after", count: 6 } }),
    );
    expect(rule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,TH;COUNT=6");
  });

  it("sorts and de-duplicates the weekday selection", () => {
    const rule = repeatSpecToRRule(spec({ freq: "weekly", byDay: [4, 1, 4, 3] }));
    expect(rule).toBe("FREQ=WEEKLY;BYDAY=MO,WE,TH");
  });

  it("drops BYDAY when no day is picked, so the start's weekday wins", () => {
    expect(repeatSpecToRRule(spec({ freq: "weekly", byDay: [] }))).toBe("FREQ=WEEKLY");
  });

  it("only emits BYDAY for weekly", () => {
    expect(repeatSpecToRRule(spec({ freq: "monthly", byDay: [1] }))).toBe("FREQ=MONTHLY");
  });

  it("caps the occurrence count", () => {
    const rule = repeatSpecToRRule(spec({ freq: "daily", end: { type: "after", count: 999 } }));
    expect(rule).toBe(`FREQ=DAILY;COUNT=${MAX_REPEAT_COUNT}`);
  });

  it("ignores an empty end date rather than emitting a broken UNTIL", () => {
    expect(repeatSpecToRRule(spec({ freq: "daily", end: { type: "on", date: "" } }))).toBe(
      "FREQ=DAILY",
    );
  });

  it("expands to exactly the days the chips selected", () => {
    // Mon 2026-09-07, 15:00Z — Mon/Wed/Thu, 6 times.
    const rule = repeatSpecToRRule(
      spec({ freq: "weekly", byDay: [1, 3, 4], end: { type: "after", count: 6 } }),
    )!;
    const days = occurrences(rule, new Date("2026-09-07T15:00:00Z")).map((d) =>
      d.toISOString().slice(0, 10),
    );
    expect(days).toEqual([
      "2026-09-07", "2026-09-09", "2026-09-10",
      "2026-09-14", "2026-09-16", "2026-09-17",
    ]);
  });

  it("skips a week when the interval is 2", () => {
    const rule = repeatSpecToRRule(
      spec({ freq: "weekly", interval: 2, byDay: [1], end: { type: "after", count: 3 } }),
    )!;
    const days = occurrences(rule, new Date("2026-09-07T15:00:00Z")).map((d) =>
      d.toISOString().slice(0, 10),
    );
    expect(days).toEqual(["2026-09-07", "2026-09-21", "2026-10-05"]);
  });

  // UNTIL is an instant while the picker offers a DAY, so the cutoff is the
  // close of that day IN THE VIEWER'S ZONE. Asserted as the stamp rather than
  // as expanded dates, which would move with the test runner's timezone.
  it("ends at the close of the chosen local day", () => {
    const rule = repeatSpecToRRule(
      spec({ freq: "daily", end: { type: "on", date: "2026-09-10" } }),
    )!;
    const until = /UNTIL=(\d{8}T\d{6}Z)/.exec(rule)?.[1];
    const expected = `${new Date("2026-09-10T23:59:59")
      .toISOString()
      .replace(/[-:]/g, "")
      .slice(0, 15)}Z`;
    expect(until).toBe(expected);
  });

  it("stops once the end date passes", () => {
    const rule = repeatSpecToRRule(
      spec({ freq: "daily", end: { type: "on", date: "2026-09-10" } }),
    )!;
    // Anchored to a LOCAL wall clock, the way every caller anchors it: the
    // cutoff is a local end-of-day, so a UTC-pinned anchor would keep 4 or 3
    // occurrences depending on the runner's offset.
    const days = occurrences(rule, new Date("2026-09-07T09:00:00"));
    expect(days).toHaveLength(4); // the 7th through the 10th
  });
});

describe("weekdayOf", () => {
  it("reads the weekday off a local date or datetime string", () => {
    expect(weekdayOf("2026-09-07")).toBe(1); // Monday
    expect(weekdayOf("2026-09-13T23:30")).toBe(0); // Sunday
  });

  it("returns null for anything unparseable", () => {
    expect(weekdayOf("")).toBeNull();
    expect(weekdayOf(undefined)).toBeNull();
  });
});
