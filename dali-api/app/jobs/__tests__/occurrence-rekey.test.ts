import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => {
  const delegate = () => ({ findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() });
  return {
    prisma: {
      scheduledMeeting: { findMany: vi.fn() },
      roomBooking: { findMany: vi.fn() },
      meetingAttendance: delegate(),
      page: { ...delegate(), update: vi.fn() },
      timeEntry: delegate(),
      meetingException: delegate(),
      meetingReminderLog: delegate(),
      meetingRecording: delegate(),
      notification: delegate(),
      displayScanSession: delegate(),
      roomBookingException: delegate(),
    },
  };
});

import { prisma } from "~/lib/db.server";
import { occurrenceKeyMap, retitledNote, runOccurrenceRekey } from "~/jobs/occurrence-rekey.server";
import { JOBS } from "~/jobs/registry";

const m = prisma as any;
const d = (s: string) => new Date(s);

// Tue/Thu 8:30pm EDT. The old UTC expansion put it on Mon/Wed 8:30pm.
const EVENING_RULE = "FREQ=WEEKLY;BYDAY=TU,TH";
const EVENING_START = d("2026-09-18T00:30:00Z");
const MON_OCT_19 = d("2026-10-20T00:30:00Z");
const TUE_OCT_20 = d("2026-10-21T00:30:00Z");

// Mon 9am EDT, which the old expansion kept at 13:00Z after DST ended.
const MORNING_RULE = "FREQ=WEEKLY;BYDAY=MO";
const MORNING_START = d("2026-09-14T13:00:00Z");

const DELEGATES = [
  "meetingAttendance",
  "page",
  "timeEntry",
  "meetingException",
  "meetingReminderLog",
  "meetingRecording",
  "notification",
  "displayScanSession",
  "roomBookingException",
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  m.scheduledMeeting.findMany.mockResolvedValue([]);
  m.roomBooking.findMany.mockResolvedValue([]);
  for (const k of DELEGATES) {
    m[k].findMany.mockResolvedValue([]);
    m[k].count.mockResolvedValue(0);
    m[k].updateMany.mockResolvedValue({ count: 1 });
  }
});

describe("occurrence-rekey registration", () => {
  it("is registered and off by default", () => {
    const job = JOBS.find((j) => j.name === "occurrence-rekey");
    expect(job?.enabledByDefault).toBe(false);
    expect(job?.handler).toBe(runOccurrenceRekey);
  });
});

describe("occurrenceKeyMap", () => {
  it("moves an evening key from the night before onto its real night", () => {
    const { moves, ambiguous } = occurrenceKeyMap(EVENING_RULE, EVENING_START, [MON_OCT_19]);
    expect(moves.get(MON_OCT_19.getTime())).toEqual(TUE_OCT_20);
    expect(ambiguous).toEqual([]);
  });

  it("moves a post-DST key onto the Eastern wall-clock hour", () => {
    const old = d("2026-11-09T13:00:00Z");
    const { moves } = occurrenceKeyMap(MORNING_RULE, MORNING_START, [old]);
    expect(moves.get(old.getTime())).toEqual(d("2026-11-09T14:00:00Z"));
  });

  it("leaves a key that is already correct alone", () => {
    const { moves, ambiguous } = occurrenceKeyMap(MORNING_RULE, MORNING_START, [d("2026-10-19T13:00:00Z")]);
    expect(moves.size).toBe(0);
    expect(ambiguous).toEqual([]);
  });

  it("is idempotent: keys it moved don't move again", () => {
    const { moves } = occurrenceKeyMap(EVENING_RULE, EVENING_START, [TUE_OCT_20]);
    expect(moves.size).toBe(0);
  });

  it("flags a key two real occurrences fold onto, and doesn't move it", () => {
    // Mon/Tue 8:30pm EDT expanded to Sun/Mon, so Monday night and Tuesday night both claim Monday's old key.
    const old = d("2026-10-20T00:30:00Z");
    const { moves, ambiguous } = occurrenceKeyMap("FREQ=WEEKLY;BYDAY=MO,TU", d("2026-09-15T00:30:00Z"), [old]);
    expect(moves.has(old.getTime())).toBe(false);
    expect(ambiguous.map((a) => a.getTime())).toContain(old.getTime());
  });

  it("returns nothing for an unparseable rule or no keys", () => {
    expect(occurrenceKeyMap("FREQ=NONSENSE", EVENING_START, [MON_OCT_19]).moves.size).toBe(0);
    expect(occurrenceKeyMap(EVENING_RULE, EVENING_START, []).moves.size).toBe(0);
  });
});

describe("retitledNote", () => {
  it("swaps a bare date title", () => {
    expect(retitledNote("Oct 19, 2026", MON_OCT_19, TUE_OCT_20)).toBe("Oct 20, 2026");
  });

  it("swaps the date inside a labelled title and keeps the rest", () => {
    expect(retitledNote("DALI OS Team meeting note (Oct 19, 2026)", MON_OCT_19, TUE_OCT_20)).toBe(
      "DALI OS Team meeting note (Oct 20, 2026)",
    );
  });

  it("leaves a title with no old date alone", () => {
    expect(retitledNote("Kickoff with partner", MON_OCT_19, TUE_OCT_20)).toBeNull();
    expect(retitledNote("Oct 20, 2026", MON_OCT_19, TUE_OCT_20)).toBeNull();
  });

  it("leaves the title alone when the move stays on the same day", () => {
    expect(retitledNote("Nov 9, 2026", d("2026-11-09T13:00:00Z"), d("2026-11-09T14:00:00Z"))).toBeNull();
  });
});

describe("runOccurrenceRekey", () => {
  beforeEach(() => {
    m.scheduledMeeting.findMany.mockResolvedValue([
      { id: "m1", title: "DALI OS Meeting", recurrenceRule: EVENING_RULE, selectedAt: EVENING_START },
    ]);
  });

  it("moves a meeting's attendance and note onto the corrected key", async () => {
    m.meetingAttendance.findMany.mockResolvedValue([{ occurrenceStart: MON_OCT_19 }, { occurrenceStart: MON_OCT_19 }]);
    m.meetingAttendance.updateMany.mockResolvedValue({ count: 2 });
    m.page.findMany.mockImplementation(async (args: any) =>
      args.select.title ? [{ id: "n1", title: "Retro" }] : [{ meetingOccurrenceStart: MON_OCT_19 }],
    );

    const res = await runOccurrenceRekey();

    expect(m.meetingAttendance.updateMany).toHaveBeenCalledWith({
      where: { scheduledMeetingId: "m1", occurrenceStart: MON_OCT_19 },
      data: { occurrenceStart: TUE_OCT_20 },
    });
    expect(m.page.updateMany).toHaveBeenCalledWith({
      where: { meetingNoteId: "m1", meetingOccurrenceStart: MON_OCT_19 },
      data: { meetingOccurrenceStart: TUE_OCT_20 },
    });
    expect(m.timeEntry.updateMany).not.toHaveBeenCalled();
    expect(res).toEqual({ items: 3, note: "moved 3 rows, skipped 0 taken keys, 0 ambiguous keys left alone" });
  });

  it("retitles a moved note whose title carries the old date, and only that one", async () => {
    m.page.findMany.mockImplementation(async (args: any) =>
      args.select.title
        ? [
            { id: "n1", title: "Oct 19, 2026" },
            { id: "n2", title: "Retro" },
          ]
        : [{ meetingOccurrenceStart: MON_OCT_19 }],
    );

    await runOccurrenceRekey();

    expect(m.page.update).toHaveBeenCalledTimes(1);
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "n1" }, data: { title: "Oct 20, 2026" } });
  });

  it("neither moves nor retitles a note whose new key is taken", async () => {
    m.page.findMany.mockResolvedValue([{ meetingOccurrenceStart: MON_OCT_19 }]);
    m.page.count.mockResolvedValue(1);

    const res = await runOccurrenceRekey();

    expect(m.page.updateMany).not.toHaveBeenCalled();
    expect(m.page.update).not.toHaveBeenCalled();
    expect(res.note).toContain("skipped 1 taken keys");
  });

  it("skips a move whose new key already has a row instead of merging", async () => {
    m.meetingAttendance.findMany.mockResolvedValue([{ occurrenceStart: MON_OCT_19 }]);
    m.meetingAttendance.count.mockResolvedValue(1);

    const res = await runOccurrenceRekey();

    expect(m.meetingAttendance.updateMany).not.toHaveBeenCalled();
    expect(res.note).toBe("moved 0 rows, skipped 1 taken keys, 0 ambiguous keys left alone");
  });

  it("moves rows that carry no unique key even when the new key is in use", async () => {
    m.notification.findMany.mockResolvedValue([{ occurrenceStart: MON_OCT_19 }, { occurrenceStart: null }]);
    m.notification.count.mockResolvedValue(5);

    await runOccurrenceRekey();

    expect(m.notification.count).not.toHaveBeenCalled();
    expect(m.notification.updateMany).toHaveBeenCalledWith({
      where: { scheduledMeetingId: "m1", occurrenceStart: MON_OCT_19 },
      data: { occurrenceStart: TUE_OCT_20 },
    });
  });

  it("rekeys a repeating room booking's exceptions", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([]);
    m.roomBooking.findMany.mockResolvedValue([
      { id: "b1", title: "Studio hold", recurrenceRule: EVENING_RULE, start: EVENING_START },
    ]);
    m.roomBookingException.findMany.mockResolvedValue([{ originalStart: MON_OCT_19 }]);

    const res = await runOccurrenceRekey();

    expect(m.roomBookingException.updateMany).toHaveBeenCalledWith({
      where: { roomBookingId: "b1", originalStart: MON_OCT_19 },
      data: { originalStart: TUE_OCT_20 },
    });
    expect(res.items).toBe(1);
  });

  it("does nothing when every key is already right", async () => {
    m.meetingAttendance.findMany.mockResolvedValue([{ occurrenceStart: TUE_OCT_20 }]);

    const res = await runOccurrenceRekey();

    for (const k of DELEGATES) expect(m[k].updateMany).not.toHaveBeenCalled();
    expect(res.items).toBe(0);
  });
});
