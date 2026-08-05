import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
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
    expect(out).toEqual({ meetings: [] });
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
    expect(callArgs.where).toMatchObject({
      organizerId: "u1",
      status: "Cancelled",
    });
  });
});
