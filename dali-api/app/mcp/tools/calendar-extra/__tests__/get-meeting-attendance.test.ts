import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the registry to prevent the circular import chain from assembling the
// full REGISTRY_TOOLS map during test setup.
vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError };
});
vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import {
  runGetMeetingAttendance,
  GET_MEETING_ATTENDANCE_DEF,
} from "~/mcp/tools/calendar-extra/get-meeting-attendance";

const mockPrisma = prisma as unknown as {
  scheduledMeeting: { findUnique: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("get_meeting_attendance", () => {
  it("requires the mcp:read scope", () => {
    expect(GET_MEETING_ATTENDANCE_DEF.requiredScope).toBe("mcp:read");
  });

  it("throws McpNotFoundError when meeting is missing", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(null);
    await expect(
      runGetMeetingAttendance("u1", { meetingId: "missing" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpNotFoundError when meetingType is null", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      title: "No Type",
      organizerId: "u1",
      projectId: null,
      meetingType: null,
      attendance: [],
    });
    await expect(
      runGetMeetingAttendance("u1", { meetingId: "m1" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpForbiddenError for non-member non-Core caller", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      title: "Meeting",
      organizerId: "u-organizer",
      projectId: "p1",
      meetingType: "Project",
      attendance: [],
    });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    await expect(
      runGetMeetingAttendance("u1", { meetingId: "m1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("returns attendance roster for Core caller", async () => {
    const mockAttendance = [
      {
        userId: "u2",
        present: true,
        markedAt: new Date("2026-08-10T14:05:00Z"),
        user: {
          id: "u2",
          firstName: "Alice",
          lastName: "Smith",
          daliEmail: "alice@dali.dartmouth.edu",
        },
      },
    ];
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      title: "Lab All-Hands",
      organizerId: "u-org",
      projectId: null,
      meetingType: "Lab",
      attendance: mockAttendance,
    });
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);

    const out = await runGetMeetingAttendance("u-core", { meetingId: "m1" });
    expect(out.meetingId).toBe("m1");
    expect(out.attendees).toHaveLength(1);
    expect(out.attendees[0]).toMatchObject({
      userId: "u2",
      firstName: "Alice",
      present: true,
      checkedInAt: "2026-08-10T14:05:00.000Z",
    });
  });
});
