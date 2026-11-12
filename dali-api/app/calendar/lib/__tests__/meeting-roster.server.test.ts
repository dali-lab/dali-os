import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { markMeetingAttendance } from "~/calendar/lib/meeting-roster.server";

vi.mock("~/lib/db.server");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("markMeetingAttendance", () => {
  const p = prisma as unknown as {
    scheduledMeeting: { findUnique: ReturnType<typeof vi.fn> };
    meetingAttendance: { findFirst: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
    timeEntry: { upsert: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    p.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      projectId: "proj-1",
      organizerId: "org-1",
      participantUserIds: ["u2"],
      durationMinutes: 60,
      selectedAt: new Date("2026-09-10T15:00:00Z"),
      createdAt: new Date("2026-09-01T12:00:00Z"),
      recurrenceRule: "FREQ=WEEKLY",
      externalEventId: null,
    });
    p.meetingAttendance.upsert.mockResolvedValue({});
    p.timeEntry.upsert.mockResolvedValue({});
    (prisma as unknown as { meetingException: unknown }).meetingException = {
      findMany: vi.fn().mockResolvedValue([]),
    };
  });

  it("marks one week of a recurring meeting and logs that week's hours", async () => {
    const week3 = new Date("2026-09-24T15:00:00Z");
    const res = await markMeetingAttendance("m1", "u2", true, "org-1", week3);

    expect(res).toEqual({ ok: true });
    const key = { scheduledMeetingId: "m1", occurrenceStart: week3, userId: "u2" };
    expect(p.meetingAttendance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scheduledMeetingId_occurrenceStart_userId: key } }),
    );
    expect(p.timeEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scheduledMeetingId_occurrenceStart_userId: key },
        create: expect.objectContaining({
          ...key,
          source: "Meeting",
          date: week3,
          startTime: week3,
          endTime: new Date("2026-09-24T16:00:00Z"),
          hours: 1,
        }),
      }),
    );
  });

  it("clears only that week's hours when marked absent", async () => {
    const week2 = new Date("2026-09-17T15:00:00Z");
    await markMeetingAttendance("m1", "u2", false, "org-1", week2);

    expect(p.timeEntry.deleteMany).toHaveBeenCalledWith({
      where: { scheduledMeetingId: "m1", occurrenceStart: week2, userId: "u2" },
    });
  });

  it("refuses someone who isn't on the roster", async () => {
    p.meetingAttendance.findFirst.mockResolvedValue(null);
    const res = await markMeetingAttendance("m1", "stranger", true, "org-1");
    expect(res).toEqual({ ok: false, error: "User was not invited to this meeting", status: 400 });
    expect(p.meetingAttendance.upsert).not.toHaveBeenCalled();
  });
});
