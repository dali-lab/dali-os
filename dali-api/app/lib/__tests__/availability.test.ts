import { describe, it, expect } from "vitest";
import { computeFreeIntervals, type ComputeInput, type Interval } from "~/lib/availability";

// Helpers ------------------------------------------------------------------

const TZ = "America/New_York";

// Build a default 9–5 Mon–Fri working-hours array.
function defaultWorkingHours() {
  return [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
    dayOfWeek: dow,
    enabled: dow >= 1 && dow <= 5,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  }));
}

// Wed 2026-05-13 ... Tue 2026-05-19 spanning a normal week well clear of DST.
// 2026 DST in NY: starts 2026-03-08, ends 2026-11-01.
function weekWindow(): { start: Date; end: Date } {
  return {
    start: new Date("2026-05-11T04:00:00Z"), // Mon 00:00 NY
    end: new Date("2026-05-18T04:00:00Z"),   // Mon 00:00 NY next week
  };
}

function baseInput(overrides: Partial<ComputeInput> = {}): ComputeInput {
  const w = weekWindow();
  return {
    windowStart: w.start,
    windowEnd: w.end,
    workingHours: defaultWorkingHours(),
    manualBlocks: [],
    externalBusy: [],
    bufferMin: 0,
    timezone: TZ,
    ...overrides,
  };
}

function totalMinutes(intervals: Interval[]): number {
  return intervals.reduce((acc, i) => acc + (i.end.getTime() - i.start.getTime()) / 60_000, 0);
}

// Tests --------------------------------------------------------------------

describe("computeFreeIntervals — working hours projection", () => {
  it("returns 5 weekday work blocks for a Mon–Mon window", () => {
    const out = computeFreeIntervals(baseInput());
    expect(out.free).toHaveLength(5);
    // Each block is 8 hours (9–17).
    expect(totalMinutes(out.free)).toBe(5 * 8 * 60);
  });

  it("returns nothing when window has zero length", () => {
    const w = weekWindow();
    const out = computeFreeIntervals(baseInput({ windowStart: w.start, windowEnd: w.start }));
    expect(out.free).toEqual([]);
    expect(out.busy).toEqual([]);
  });

  it("excludes disabled days entirely", () => {
    const wh = defaultWorkingHours().map((d) => (d.dayOfWeek === 1 ? { ...d, enabled: false } : d));
    const out = computeFreeIntervals(baseInput({ workingHours: wh }));
    // Monday removed → 4 blocks.
    expect(out.free).toHaveLength(4);
  });

  it("handles a window that doesn't start on a day boundary", () => {
    // Monday 14:00 NY → Monday 17:00 NY (3h).
    const out = computeFreeIntervals(
      baseInput({
        windowStart: new Date("2026-05-11T18:00:00Z"),
        windowEnd: new Date("2026-05-11T21:00:00Z"),
      }),
    );
    expect(totalMinutes(out.free)).toBe(3 * 60);
  });
});

describe("computeFreeIntervals — manual blocks", () => {
  it("subtracts a one-off block from working hours", () => {
    // Block Mon 11:00–12:00 NY.
    const block = {
      startTime: new Date("2026-05-11T15:00:00Z"),
      endTime: new Date("2026-05-11T16:00:00Z"),
      recurrenceRule: null,
    };
    const out = computeFreeIntervals(baseInput({ manualBlocks: [block] }));
    // 5 days × 8h = 40h, minus 1h = 39h.
    expect(totalMinutes(out.free)).toBe(39 * 60);
    // Busy should contain exactly the one block.
    expect(out.busy).toHaveLength(1);
  });

  it("expands a weekly RRULE across the window", () => {
    // Block Mon 11:00–12:00 weekly. Window is one Mon→Mon so only one occurrence.
    const block = {
      startTime: new Date("2026-05-11T15:00:00Z"),
      endTime: new Date("2026-05-11T16:00:00Z"),
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
    };
    const out = computeFreeIntervals(baseInput({ manualBlocks: [block] }));
    expect(totalMinutes(out.free)).toBe(39 * 60);

    // Now expand the window to two weeks → expect two occurrences subtracted.
    const out2 = computeFreeIntervals(
      baseInput({
        manualBlocks: [block],
        windowEnd: new Date("2026-05-25T04:00:00Z"),
      }),
    );
    expect(totalMinutes(out2.free)).toBe(2 * 40 * 60 - 2 * 60);
  });

  it("ignores manual blocks entirely outside working hours", () => {
    // Block Mon 2:00–3:00 AM NY (before working hours).
    const block = {
      startTime: new Date("2026-05-11T06:00:00Z"),
      endTime: new Date("2026-05-11T07:00:00Z"),
      recurrenceRule: null,
    };
    const out = computeFreeIntervals(baseInput({ manualBlocks: [block] }));
    expect(totalMinutes(out.free)).toBe(40 * 60);
  });

  it("inflates busy intervals by the buffer on both sides", () => {
    // 60-min block Mon 11:00–12:00; with 15-min buffer it eats 11:00–12:00
    // out of working hours but the buffer also bites into adjacent free time.
    const block = {
      startTime: new Date("2026-05-11T15:00:00Z"),
      endTime: new Date("2026-05-11T16:00:00Z"),
      recurrenceRule: null,
    };
    const out = computeFreeIntervals(baseInput({ manualBlocks: [block], bufferMin: 15 }));
    // Lost time = 60 + 2*15 = 90 min.
    expect(totalMinutes(out.free)).toBe(40 * 60 - 90);
  });

  it("merges overlapping busy intervals after buffer inflation", () => {
    // Two blocks 30 min apart, with a 20-min buffer they overlap into a single span.
    const blocks = [
      { startTime: new Date("2026-05-11T15:00:00Z"), endTime: new Date("2026-05-11T16:00:00Z"), recurrenceRule: null },
      { startTime: new Date("2026-05-11T16:30:00Z"), endTime: new Date("2026-05-11T17:30:00Z"), recurrenceRule: null },
    ];
    const out = computeFreeIntervals(baseInput({ manualBlocks: blocks, bufferMin: 20 }));
    expect(out.busy).toHaveLength(1);
  });
});

describe("computeFreeIntervals — external busy", () => {
  it("subtracts external busy intervals from working hours", () => {
    const externalBusy: Interval[] = [
      { start: new Date("2026-05-12T18:00:00Z"), end: new Date("2026-05-12T20:00:00Z") },
    ];
    const out = computeFreeIntervals(baseInput({ externalBusy }));
    expect(totalMinutes(out.free)).toBe(40 * 60 - 2 * 60);
  });
});

describe("computeFreeIntervals — DST boundary", () => {
  it("returns 8-hour block on a fall-back day", () => {
    // 2026-11-01 is DST end in NY (the 25-hour day). Working hours 9–17
    // should still be 8h because hours are anchored to local time.
    const out = computeFreeIntervals({
      windowStart: new Date("2026-11-01T04:00:00Z"), // Sun 00:00 EDT
      windowEnd: new Date("2026-11-02T05:00:00Z"),   // Mon 00:00 EST
      workingHours: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
        dayOfWeek: dow,
        enabled: true,
        startMinute: 9 * 60,
        endMinute: 17 * 60,
      })),
      manualBlocks: [],
      externalBusy: [],
      bufferMin: 0,
      timezone: TZ,
    });
    // Only Sunday's 9–17 falls fully inside the window — Monday's 9–17 is
    // past windowEnd (Mon 00:00 EST).
    expect(totalMinutes(out.free)).toBe(8 * 60);
  });
});
