import { describe, it, expect, beforeEach, vi } from "vitest";

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
vi.mock("~/lib/scheduled-meeting", () => ({
  markMeetingAttendance: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { markMeetingAttendance } from "~/lib/scheduled-meeting";
import {
  runMarkMeetingAttendance,
  MARK_MEETING_ATTENDANCE_DEF,
} from "~/mcp/tools/calendar-extra/mark-meeting-attendance";

const mockPrisma = prisma as unknown as {
  scheduledMeeting: { findUnique: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mark_meeting_attendance", () => {
  it("requires mcp:write scope", () => {
    expect(MARK_MEETING_ATTENDANCE_DEF.requiredScope).toBe("mcp:write");
  });

  it("throws McpNotFoundError when meeting is missing", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(null);
    await expect(
      runMarkMeetingAttendance("u1", { meetingId: "missing", userId: "u2", present: true }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpNotFoundError when meetingType is null", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "u1",
      projectId: null,
      meetingType: null,
    });
    await expect(
      runMarkMeetingAttendance("u1", { meetingId: "m1", userId: "u2", present: true }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpForbiddenError for non-member non-Core non-organizer", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "u-org",
      projectId: "p1",
      meetingType: "Team",
    });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    await expect(
      runMarkMeetingAttendance("u-other", { meetingId: "m1", userId: "u2", present: true }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("succeeds for organizer", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "u-org",
      projectId: null,
      meetingType: "Other",
    });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    vi.mocked(markMeetingAttendance).mockResolvedValue({ ok: true });

    const out = await runMarkMeetingAttendance("u-org", { meetingId: "m1", userId: "u2", present: true });
    expect(out).toEqual({ ok: true });
    expect(markMeetingAttendance).toHaveBeenCalledWith("m1", "u2", true, "u-org");
  });

  it("succeeds for Core caller", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "u-org",
      projectId: null,
      meetingType: "Other",
    });
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    vi.mocked(markMeetingAttendance).mockResolvedValue({ ok: true });

    const out = await runMarkMeetingAttendance("u-core", { meetingId: "m1", userId: "u2", present: false });
    expect(out).toEqual({ ok: true });
  });

  it("throws McpInvalidError when markMeetingAttendance returns error", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      organizerId: "u-org",
      projectId: null,
      meetingType: "Other",
    });
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    vi.mocked(markMeetingAttendance).mockResolvedValue({
      ok: false,
      error: "User was not invited to this meeting",
      status: 400,
    });

    await expect(
      runMarkMeetingAttendance("u-core", { meetingId: "m1", userId: "u-uninvited", present: true }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });
});
