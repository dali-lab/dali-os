import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import {
  runListScheduledMeetings,
  LIST_SCHEDULED_MEETINGS_DEF,
} from "~/mcp/tools/calendar-extra/list-scheduled-meetings";

const mockPrisma = prisma as unknown as {
  scheduledMeeting: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_scheduled_meetings", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_SCHEDULED_MEETINGS_DEF.requiredScope).toBe("mcp:read");
  });

  it("returns empty array when user has no meetings", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([]);
    const out = await runListScheduledMeetings("u1", {});
    expect(out).toEqual({
      meetings: [],
      page: { nextCursor: null, hasMore: false, limit: 50 },
    });
    expect(prisma.scheduledMeeting.findMany).toHaveBeenCalled();
  });

  it("maps meeting fields and computes participantCount correctly", async () => {
    const mockMeeting = {
      id: "m1",
      title: "Team Sync",
      status: "Confirmed",
      selectedAt: new Date("2026-08-10T14:00:00Z"),
      durationMinutes: 60,
      meetingType: "Project",
      projectId: "p1",
      attendanceMode: "Manual",
      organizerId: "u1",
      participantUserIds: ["u2", "u3"],
    };
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([mockMeeting]);
    const out = await runListScheduledMeetings("u1", { limit: 10 });
    expect(out.meetings).toHaveLength(1);
    expect(out.meetings[0]).not.toHaveProperty("createdAt");
    expect(out.meetings[0]).toMatchObject({
      id: "m1",
      title: "Team Sync",
      status: "Confirmed",
      selectedAt: "2026-08-10T14:00:00.000Z",
      durationMinutes: 60,
      meetingType: "Project",
      projectId: "p1",
      attendanceMode: "Manual",
      participantCount: 3, // organizer + 2 participants
    });
  });

  it("filters by organizer role and status", async () => {
    mockPrisma.scheduledMeeting.findMany.mockResolvedValue([]);
    await runListScheduledMeetings("u1", { role: "organizer", status: "Cancelled" });
    const callArgs = mockPrisma.scheduledMeeting.findMany.mock.calls[0][0];
    expect(callArgs.where.AND[0]).toMatchObject({
      organizerId: "u1",
      status: "Cancelled",
    });
  });

  it("walks pages newest first with a cursor and ends with a null cursor", async () => {
    const row = (id: string, day: number) => ({
      id,
      createdAt: new Date(Date.UTC(2026, 7, day)),
      title: id,
      status: "Confirmed",
      selectedAt: null,
      durationMinutes: 30,
      meetingType: null,
      projectId: null,
      attendanceMode: "Manual",
      organizerId: "u1",
      participantUserIds: [],
      meetingUrl: null,
    });
    mockPrisma.scheduledMeeting.findMany.mockResolvedValueOnce([row("m3", 3), row("m2", 2), row("m1", 1)]);
    const first = await runListScheduledMeetings("u1", { limit: 2 });
    expect(first.meetings.map((m) => m.id)).toEqual(["m3", "m2"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2 });
    expect(mockPrisma.scheduledMeeting.findMany.mock.calls[0][0]).toMatchObject({
      take: 3,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    mockPrisma.scheduledMeeting.findMany.mockResolvedValueOnce([row("m1", 1)]);
    const second = await runListScheduledMeetings("u1", { limit: 2, cursor: first.page.nextCursor! });
    const where = mockPrisma.scheduledMeeting.findMany.mock.calls[1][0].where;
    expect(where.AND[1].OR[0]).toEqual({ createdAt: { lt: new Date(Date.UTC(2026, 7, 2)) } });
    expect(second.meetings.map((m) => m.id)).toEqual(["m1"]);
    expect(second.page).toMatchObject({ nextCursor: null, hasMore: false });
  });
});
