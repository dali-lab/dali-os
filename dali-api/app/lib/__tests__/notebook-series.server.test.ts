import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { scheduledMeeting: { findMany: vi.fn() }, page: { findMany: vi.fn() } },
}));

import { prisma } from "~/lib/db.server";
import { nextNoteTargets } from "~/lib/notebook-series.server";

const m = prisma as any;
const NOW = new Date("2026-09-16T12:00:00Z");

const series = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  title: "Weekly sync",
  selectedAt: new Date("2026-09-10T15:00:00Z"),
  durationMinutes: 60,
  recurrenceRule: "FREQ=WEEKLY",
  exceptions: [],
  notePages: [{ meetingOccurrenceStart: new Date("2026-09-10T15:00:00Z") }],
  ...over,
});

const oneOff = (over: Record<string, unknown> = {}) =>
  series({ id: "m9", title: "Kickoff", recurrenceRule: null, selectedAt: new Date("2026-09-18T15:00:00Z"), notePages: [], ...over });

beforeEach(() => {
  vi.resetAllMocks();
  m.scheduledMeeting.findMany.mockResolvedValue([]);
  m.page.findMany.mockResolvedValue([]);
});

describe("nextNoteTargets", () => {
  it("is the next upcoming occurrence of the series that files into the notebook", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([series()]);

    expect(await nextNoteTargets("nb1", NOW)).toEqual([
      { meetingId: "m1", meetingTitle: "Weekly sync", occurrenceStart: "2026-09-17T15:00:00.000Z" },
    ]);
    expect(m.scheduledMeeting.findMany.mock.calls[0][0].where).toMatchObject({ notebookId: "nb1" });
  });

  it("skips an occurrence that already has its note", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([
      series({
        notePages: [
          { meetingOccurrenceStart: new Date("2026-09-10T15:00:00Z") },
          { meetingOccurrenceStart: new Date("2026-09-17T15:00:00Z") },
        ],
      }),
    ]);

    expect((await nextNoteTargets("nb1", NOW))[0].occurrenceStart).toBe("2026-09-24T15:00:00.000Z");
  });

  it("includes the series one of the notebook's notes belongs to", async () => {
    m.page.findMany.mockResolvedValue([{ meetingNote: series({ id: "m2" }) }]);

    expect(await nextNoteTargets("nb1", NOW)).toMatchObject([{ meetingId: "m2" }]);
  });

  it("lists every series that files into the notebook, recurring before one-offs, then by start", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([
      oneOff(),
      series({ id: "m3", title: "Retro", selectedAt: new Date("2026-09-11T15:00:00Z"), notePages: [] }),
      series(),
    ]);

    expect((await nextNoteTargets("nb1", NOW)).map((t) => [t.meetingId, t.occurrenceStart])).toEqual([
      ["m1", "2026-09-17T15:00:00.000Z"],
      ["m3", "2026-09-18T15:00:00.000Z"],
      ["m9", "2026-09-18T15:00:00.000Z"],
    ]);
  });

  it("drops a series whose every upcoming occurrence has its note", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([
      series({ recurrenceRule: null, selectedAt: new Date("2026-09-18T15:00:00Z"), notePages: [{ meetingOccurrenceStart: new Date("2026-09-18T15:00:00Z") }] }),
    ]);

    expect(await nextNoteTargets("nb1", NOW)).toEqual([]);
  });

  it("includes a one-off behind a tab once, even when it also files into the notebook", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([oneOff()]);
    m.page.findMany.mockResolvedValue([{ meetingNote: oneOff() }, { meetingNote: oneOff() }]);

    expect(await nextNoteTargets("nb1", NOW)).toHaveLength(1);
  });

  it("is empty for a notebook with no series", async () => {
    expect(await nextNoteTargets("nb1", NOW)).toEqual([]);
  });

  it("is empty for a one-off meeting that has passed", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([series({ recurrenceRule: null, notePages: [] })]);

    expect(await nextNoteTargets("nb1", NOW)).toEqual([]);
  });
});
