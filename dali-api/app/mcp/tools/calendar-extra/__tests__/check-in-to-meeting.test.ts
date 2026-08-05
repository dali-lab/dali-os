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
vi.mock("~/lib/scheduled-meeting", () => ({
  markMeetingAttendance: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { markMeetingAttendance } from "~/lib/scheduled-meeting";
import {
  runCheckInToMeeting,
  CHECK_IN_TO_MEETING_DEF,
} from "~/mcp/tools/calendar-extra/check-in-to-meeting";

const mockPrisma = prisma as unknown as {
  scheduledMeeting: { findUnique: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("check_in_to_meeting", () => {
  it("requires the mcp:write scope", () => {
    expect(CHECK_IN_TO_MEETING_DEF.requiredScope).toBe("mcp:write");
  });

  it("throws McpNotFoundError when meeting is missing", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(null);
    await expect(
      runCheckInToMeeting("u1", { meetingId: "missing" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpNotFoundError when attendanceMode is not SelfCheckIn", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      attendanceMode: "Manual",
      selectedAt: new Date(),
      durationMinutes: 60,
    });
    await expect(
      runCheckInToMeeting("u1", { meetingId: "m1" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpForbiddenError when outside the grace window", async () => {
    // Meeting started 2 hours ago, 60 min duration, window closed
    const selectedAt = new Date(Date.now() - 2 * 60 * 60_000);
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      attendanceMode: "SelfCheckIn",
      selectedAt,
      durationMinutes: 60,
    });
    await expect(
      runCheckInToMeeting("u1", { meetingId: "m1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("returns ok:true when check-in succeeds within the window", async () => {
    // Meeting starts 5 minutes from now — within the 15-min grace window
    const selectedAt = new Date(Date.now() + 5 * 60_000);
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      id: "m1",
      attendanceMode: "SelfCheckIn",
      selectedAt,
      durationMinutes: 60,
    });
    vi.mocked(markMeetingAttendance).mockResolvedValue({ ok: true });

    const out = await runCheckInToMeeting("u1", { meetingId: "m1" });
    expect(out).toEqual({ ok: true });
    expect(markMeetingAttendance).toHaveBeenCalledWith("m1", "u1", true, "u1");
  });
});
