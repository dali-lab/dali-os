import { describe, it, expect } from "vitest";
import {
  expandOccurrences,
  googleInstanceOriginalStart,
  matchMeetingForEvent,
  resolveOccurrence,
} from "~/lib/meeting-occurrences";

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

describe("resolveOccurrence", () => {
  const CREATED = new Date("2026-07-01T12:00:00Z");
  const series = (over: Record<string, unknown> = {}) => ({ ...weekly(), createdAt: CREATED, ...over });

  it("is the first occurrence when nothing says which", () => {
    expect(resolveOccurrence(series(), []).originalStart).toEqual(START);
  });

  it("is createdAt for a meeting with no time yet", () => {
    const occ = resolveOccurrence(series({ selectedAt: null }), [], new Date("2026-07-29T15:00:00Z"));
    expect(occ.originalStart).toEqual(CREATED);
  });

  it("finds a later week of a series by its start", () => {
    const occ = resolveOccurrence(series(), [], new Date("2026-07-29T15:00:00Z"));
    expect(occ.originalStart).toEqual(new Date("2026-07-29T15:00:00Z"));
    expect(occ.end).toEqual(new Date("2026-07-29T15:30:00Z"));
  });

  it("snaps an instant inside or near a week to that week", () => {
    // Mid-meeting (check-in), and an hour off (a DST-shifted Google instance).
    expect(resolveOccurrence(series(), [], new Date("2026-07-22T15:10:00Z")).originalStart).toEqual(
      new Date("2026-07-22T15:00:00Z"),
    );
    expect(resolveOccurrence(series(), [], new Date("2026-07-22T16:00:00Z")).originalStart).toEqual(
      new Date("2026-07-22T15:00:00Z"),
    );
  });

  it("keys a moved occurrence on its original start, from either time", () => {
    const moved = [
      {
        originalStart: new Date("2026-07-22T15:00:00Z"),
        overrideStart: new Date("2026-07-24T18:00:00Z"),
        overrideDurationMin: null,
        cancelled: false,
      },
    ];
    for (const at of ["2026-07-22T15:00:00Z", "2026-07-24T18:00:00Z"]) {
      const occ = resolveOccurrence(series(), moved, new Date(at));
      expect(occ.originalStart).toEqual(new Date("2026-07-22T15:00:00Z"));
      expect(occ.start).toEqual(new Date("2026-07-24T18:00:00Z"));
    }
  });

  it("keeps a one-off meeting on its one key", () => {
    const occ = resolveOccurrence(series({ recurrenceRule: null }), [], new Date("2026-08-15T15:00:00Z"));
    expect(occ.originalStart).toEqual(START);
  });

  it("keeps each instance of a Google series it can't expand apart", () => {
    const tracked = series({ recurrenceRule: null, externalEventId: "gcal-master" });
    expect(resolveOccurrence(tracked, [], new Date("2026-07-15T15:00:00Z")).originalStart).toEqual(START);
    expect(resolveOccurrence(tracked, [], new Date("2026-07-22T15:00:00Z")).originalStart).toEqual(
      new Date("2026-07-22T15:00:00Z"),
    );
  });
});

describe("googleInstanceOriginalStart", () => {
  it("reads a timed instance's original start from its id", () => {
    expect(googleInstanceOriginalStart("abc_20260722T150000Z", "abc")).toEqual(
      new Date("2026-07-22T15:00:00Z"),
    );
  });

  it("reads an all-day instance", () => {
    expect(googleInstanceOriginalStart("abc_20260722", "abc")).toEqual(new Date("2026-07-22T00:00:00Z"));
  });

  it("is null for a one-off event or an id it doesn't recognise", () => {
    expect(googleInstanceOriginalStart("abc", null)).toBeNull();
    expect(googleInstanceOriginalStart("xyz_20260722T150000Z", "abc")).toBeNull();
    expect(googleInstanceOriginalStart("abc_moved", "abc")).toBeNull();
  });
});

describe("matchMeetingForEvent", () => {
  const meeting = { id: "m1", externalEventId: "master", iCalUID: "uid-123@google.com" };
  const byExternalId = new Map([["master", meeting]]);
  const byICalUID = new Map([["uid-123@google.com", meeting]]);

  it("matches a detached instance (no recurringEventId) by its stable iCalUID", () => {
    // Google handed this copy the instance id but dropped recurringEventId, so
    // neither the instance id nor a master reaches byExternalId — the regression
    // that showed a linked meeting as a plain Google event. iCalUID recovers it.
    const event = {
      eventId: "master_20260928T130000Z",
      recurringEventId: null,
      iCalUID: "uid-123@google.com",
    };
    expect(matchMeetingForEvent(event, byICalUID, byExternalId)).toBe(meeting);
  });

  it("matches a well-formed recurring instance through its master id", () => {
    const event = {
      eventId: "master_20260921T130000Z",
      recurringEventId: "master",
      iCalUID: "uid-123@google.com",
    };
    expect(matchMeetingForEvent(event, byICalUID, byExternalId)).toBe(meeting);
  });

  it("prefers iCalUID over a stale externalEventId collision", () => {
    // A row still keyed on an old master resolves by UID even if the event's
    // own id no longer matches anything in byExternalId.
    const event = { eventId: "new-master_20260928T130000Z", recurringEventId: "new-master", iCalUID: "uid-123@google.com" };
    expect(matchMeetingForEvent(event, byICalUID, byExternalId)).toBe(meeting);
  });

  it("falls back to externalEventId when the row has no iCalUID yet", () => {
    // Pre-backfill row: byICalUID is empty, event id still bridges to the master.
    const event = { eventId: "master_20260928T130000Z", recurringEventId: "master", iCalUID: "uid-123@google.com" };
    expect(matchMeetingForEvent(event, new Map(), byExternalId)).toBe(meeting);
  });

  it("returns null when nothing matches", () => {
    const event = { eventId: "other_20260928T130000Z", recurringEventId: "other", iCalUID: "other-uid@google.com" };
    expect(matchMeetingForEvent(event, byICalUID, byExternalId)).toBeNull();
  });
});
