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
        rooms: [],
      },
    ]);
    mockPrisma.interview.findMany.mockResolvedValue([
      {
        id: "iv1",
        startTime: new Date("2026-05-14T15:00:00Z"),
        endTime: new Date("2026-05-14T15:30:00Z"),
        videoUrl: null,
        room: { name: "Pod Appa" },
        assignments: [
          { id: "a1", cycleInterviewer: { userId: "user-1" } },
          { id: "a2", cycleInterviewer: { userId: "user-3" } },
        ],
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
      attendeeIds: ["user-1", "user-3"],
    });
    expect(out[1]).toMatchObject({
      id: "m1",
      source: "dali",
      occurrenceStart: "2026-05-15T14:00:00.000Z",
      scheduledMeetingId: "m1",
      meetingUrl: "https://meet.example/m1",
      attendeeCount: 2,
      attendeeIds: ["user-1", "user-2"],
      location: null,
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
        rooms: [],
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
        rooms: [],
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
        rooms: [],
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

  it("uses the meeting's own location, falling back to its booked rooms, and carries its calendar ids", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      {
        id: "m-room",
        organizerId: "user-2",
        title: "Crit",
        durationMinutes: 60,
        selectedAt: new Date("2026-05-15T18:00:00Z"),
        recurrenceRule: null,
        meetingUrl: null,
        participantUserIds: ["user-1", "user-2"],
        status: "Confirmed",
        exceptions: [],
        rooms: [{ name: "Pod Appa" }, { name: "Pod Momo" }],
        location: null,
        description: "Bring sketches",
        externalEventId: "g-1",
        iCalUID: "uid-1",
      },
      {
        id: "m-loc",
        organizerId: "user-1",
        title: "Coffee",
        durationMinutes: 30,
        selectedAt: new Date("2026-05-16T14:00:00Z"),
        recurrenceRule: null,
        meetingUrl: null,
        participantUserIds: [],
        status: "Confirmed",
        exceptions: [],
        rooms: [{ name: "Pod Appa" }],
        location: "Dirt Cowboy",
      },
    ]);
    mockPrisma.interview.findMany.mockResolvedValue([]);

    const out = await listUpcomingMeetings("user-1", NOW, WINDOW_END);
    expect(out[0]).toMatchObject({
      location: "Pod Appa, Pod Momo",
      description: "Bring sketches",
      externalEventId: "g-1",
      iCalUID: "uid-1",
      attendeeIds: ["user-2", "user-1"],
    });
    expect(out[1]).toMatchObject({ location: "Dirt Cowboy", attendeeIds: ["user-1"] });
  });

  it("puts the date window in the query, keeping every recurring series", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([]);
    mockPrisma.interview.findMany.mockResolvedValue([]);

    await listUpcomingMeetings("user-1", NOW, WINDOW_END);

    const args = mockPrisma.scheduledMeeting.findMany.mock.calls[0][0];
    expect(args.where.AND[1]).toEqual({
      OR: [
        { recurrenceRule: { not: null } },
        { selectedAt: { gte: new Date("2026-05-14T04:00:00Z"), lt: WINDOW_END } },
      ],
    });
    expect(args.orderBy).toEqual([{ selectedAt: "asc" }, { id: "asc" }]);
  });

  it("still expands a recurring meeting that started long before the window", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([
      {
        id: "weekly",
        organizerId: "user-1",
        title: "Weekly",
        durationMinutes: 30,
        selectedAt: new Date("2025-01-06T15:00:00Z"),
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
        participantUserIds: [],
        status: "Confirmed",
        exceptions: [],
        rooms: [],
      },
    ]);
    mockPrisma.interview.findMany.mockResolvedValue([]);

    const out = await listUpcomingMeetings("user-1", NOW, WINDOW_END);
    expect(out.map((o) => o.startsAt)).toEqual(["2026-05-18T14:00:00.000Z"]);
  });

  it("reads interviews in a stable order with no row cap", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([]);
    mockPrisma.interview.findMany.mockResolvedValue([]);

    await listUpcomingMeetings("user-1", NOW, WINDOW_END);

    const args = mockPrisma.interview.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ startTime: "asc" }, { id: "asc" }]);
    expect(args).not.toHaveProperty("take");
  });
});
