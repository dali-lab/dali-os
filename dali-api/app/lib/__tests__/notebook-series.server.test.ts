import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { scheduledMeeting: { findFirst: vi.fn() }, page: { findFirst: vi.fn() } },
}));

import { prisma } from "~/lib/db";
import { nextNoteTarget } from "~/lib/notebook-series.server";

const m = prisma as any;
const NOW = new Date("2026-09-16T12:00:00Z");

const series = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  selectedAt: new Date("2026-09-10T15:00:00Z"),
  durationMinutes: 60,
  recurrenceRule: "FREQ=WEEKLY",
  exceptions: [],
  notePages: [{ meetingOccurrenceStart: new Date("2026-09-10T15:00:00Z") }],
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.scheduledMeeting.findFirst.mockResolvedValue(null);
  m.page.findFirst.mockResolvedValue(null);
});

describe("nextNoteTarget", () => {
  it("is the next upcoming occurrence of the series that files into the notebook", async () => {
    m.scheduledMeeting.findFirst.mockResolvedValue(series());

    expect(await nextNoteTarget("nb1", NOW)).toEqual({
      meetingId: "m1",
      occurrenceStart: "2026-09-17T15:00:00.000Z",
    });
    expect(m.scheduledMeeting.findFirst.mock.calls[0][0].where).toMatchObject({ notebookId: "nb1" });
  });

  it("skips an occurrence that already has its note", async () => {
    m.scheduledMeeting.findFirst.mockResolvedValue(
      series({
        notePages: [
          { meetingOccurrenceStart: new Date("2026-09-10T15:00:00Z") },
          { meetingOccurrenceStart: new Date("2026-09-17T15:00:00Z") },
        ],
      }),
    );

    expect((await nextNoteTarget("nb1", NOW))?.occurrenceStart).toBe("2026-09-24T15:00:00.000Z");
  });

  it("falls back to the series one of the notebook's notes belongs to", async () => {
    m.page.findFirst.mockResolvedValue({ meetingNote: series({ id: "m2" }) });

    expect(await nextNoteTarget("nb1", NOW)).toMatchObject({ meetingId: "m2" });
  });

  it("is null for a notebook with no series", async () => {
    expect(await nextNoteTarget("nb1", NOW)).toBeNull();
  });

  it("is null for a one-off meeting that has passed", async () => {
    m.scheduledMeeting.findFirst.mockResolvedValue(series({ recurrenceRule: null, notePages: [] }));

    expect(await nextNoteTarget("nb1", NOW)).toBeNull();
  });
});
