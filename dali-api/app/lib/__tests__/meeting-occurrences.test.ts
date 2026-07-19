import { describe, it, expect } from "vitest";
import { expandOccurrences } from "~/lib/meeting-occurrences";

const START = new Date("2026-07-15T15:00:00Z");
const WINDOW_START = new Date("2026-07-15T00:00:00Z");
const WINDOW_END = new Date("2026-07-22T00:00:00Z");

function weekly(overrides: Record<string, unknown> = {}) {
  return {
    selectedAt: START,
    durationMinutes: 30,
    recurrenceRule: "FREQ=WEEKLY",
    ...overrides,
  };
}

describe("expandOccurrences", () => {
  it("returns nothing for an unscheduled meeting", () => {
    expect(
      expandOccurrences(weekly({ selectedAt: null }), [], WINDOW_START, WINDOW_END),
    ).toEqual([]);
  });

  it("expands recurring occurrences with original starts in the window", () => {
    const occs = expandOccurrences(weekly(), [], WINDOW_START, WINDOW_END);
    expect(occs).toHaveLength(1);
    expect(occs[0]).toEqual({
      originalStart: START,
      start: START,
      end: new Date(START.getTime() + 30 * 60_000),
    });

    const wider = expandOccurrences(
      weekly(),
      [],
      WINDOW_START,
      new Date("2026-07-30T00:00:00Z"),
    );
    expect(wider.map((o) => o.originalStart.toISOString())).toEqual([
      "2026-07-15T15:00:00.000Z",
      "2026-07-22T15:00:00.000Z",
      "2026-07-29T15:00:00.000Z",
    ]);
  });

  it("skips cancelled occurrences", () => {
    const occs = expandOccurrences(
      weekly(),
      [
        {
          originalStart: START,
          overrideStart: null,
          overrideDurationMin: null,
          cancelled: true,
        },
      ],
      WINDOW_START,
      WINDOW_END,
    );
    expect(occs).toEqual([]);
  });

  it("applies start/duration overrides while keeping originalStart as the key", () => {
    const moved = new Date("2026-07-15T18:30:00Z");
    const occs = expandOccurrences(
      weekly(),
      [
        {
          originalStart: START,
          overrideStart: moved,
          overrideDurationMin: 45,
          cancelled: false,
        },
      ],
      WINDOW_START,
      WINDOW_END,
    );
    expect(occs).toEqual([
      {
        originalStart: START,
        start: moved,
        end: new Date(moved.getTime() + 45 * 60_000),
      },
    ]);
  });

  it("handles single (non-recurring) meetings by span intersection", () => {
    const single = weekly({ recurrenceRule: null });
    expect(expandOccurrences(single, [], WINDOW_START, WINDOW_END)).toHaveLength(1);
    // Window entirely before the meeting.
    expect(
      expandOccurrences(
        single,
        [],
        new Date("2026-07-01T00:00:00Z"),
        new Date("2026-07-02T00:00:00Z"),
      ),
    ).toEqual([]);
  });

  it("returns nothing for an unparseable rule", () => {
    expect(
      expandOccurrences(
        weekly({ recurrenceRule: "FREQ=NONSENSE;GARBAGE" }),
        [],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toEqual([]);
  });
});
