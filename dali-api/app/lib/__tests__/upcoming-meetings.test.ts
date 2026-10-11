import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { listUpcomingMeetings } from "~/lib/upcoming-meetings";

const mockPrisma = prisma as unknown as {
  scheduledMeeting: { findMany: ReturnType<typeof vi.fn> };
  interview: { findMany: ReturnType<typeof vi.fn> };
};

const NOW = new Date("2026-05-14T12:00:00Z");
const WINDOW_END = new Date("2026-05-21T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listUpcomingMeetings", () => {
  it("sorts scheduled meetings and interviews by start, stamping occurrenceStart/scheduledMeetingId", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      {
        id: "m1",
        organizerId: "user-1",
        title: "Sync",
        durationMinutes: 30,
        selectedAt: new Date("2026-05-15T14:00:00Z"),
        recurrenceRule: null,
        meetingUrl: "https://meet.example/m1",
        participantUserIds: ["user-1", "user-2"],
        status: "Confirmed",
        exceptions: [],
      },
    ]);
    mockPrisma.interview.findMany.mockResolvedValue([
      {
        id: "iv1",
        startTime: new Date("2026-05-14T15:00:00Z"),
        endTime: new Date("2026-05-14T15:30:00Z"),
        videoUrl: null,
        room: { name: "Pod Appa" },
        assignments: [{ id: "a1" }, { id: "a2" }],
      },
    ]);

    const out = await listUpcomingMeetings("user-1", NOW, WINDOW_END);

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: "iv1",
      source: "interview",
      occurrenceStart: "2026-05-14T15:00:00.000Z",
      scheduledMeetingId: null,
      location: "Pod Appa",
    });
    expect(out[1]).toMatchObject({
      id: "m1",
      source: "dali",
      occurrenceStart: "2026-05-15T14:00:00.000Z",
      scheduledMeetingId: "m1",
      meetingUrl: "https://meet.example/m1",
      attendeeCount: 2,
    });
    expect(out[1].startsAt).toBe(out[1].occurrenceStart);
  });

  it("excludes occurrences that end before now or start at/after the window end", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      {
        id: "m-past",
        organizerId: "user-1",
        title: "Old",
        durationMinutes: 30,
        selectedAt: new Date("2026-05-10T12:00:00Z"),
        recurrenceRule: null,
        meetingUrl: null,
        participantUserIds: ["user-1"],
        status: "Confirmed",
        exceptions: [],
      },
      {
        id: "m-after-window",
        organizerId: "user-1",
        title: "Later",
        durationMinutes: 30,
        selectedAt: new Date("2026-05-21T12:00:00Z"),
        recurrenceRule: null,
        meetingUrl: null,
        participantUserIds: ["user-1"],
        status: "Confirmed",
        exceptions: [],
      },
    ]);
    mockPrisma.interview.findMany.mockResolvedValue([]);

    const out = await listUpcomingMeetings("user-1", NOW, WINDOW_END);
    expect(out).toEqual([]);
  });

  it("includes an in-progress occurrence whose end is still ahead of now", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      {
        id: "m-live",
        organizerId: "user-1",
        title: "Live now",
        durationMinutes: 60,
        selectedAt: new Date("2026-05-14T11:45:00Z"),
        recurrenceRule: null,
        meetingUrl: null,
        participantUserIds: ["user-1"],
        status: "Confirmed",
        exceptions: [],
      },
    ]);
    mockPrisma.interview.findMany.mockResolvedValue([]);

    const out = await listUpcomingMeetings("user-1", NOW, WINDOW_END);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("m-live");
  });

  it("returns empty when there are no meetings or interviews", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([]);
    mockPrisma.interview.findMany.mockResolvedValue([]);
    const out = await listUpcomingMeetings("user-1", NOW, WINDOW_END);
    expect(out).toEqual([]);
  });
});
