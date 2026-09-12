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
vi.mock("~/lib/display", () => ({
  fullName: (u: { firstName: string; lastName: string }) =>
    `${u.firstName} ${u.lastName}`.trim(),
}));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { runGetMeeting, GET_MEETING_DEF } from "~/mcp/tools/calendar-extra/get-meeting";

const mockPrisma = prisma as unknown as {
  scheduledMeeting: { findUnique: ReturnType<typeof vi.fn> };
};

const MEETING_BASE = {
  id: "m1",
  title: "Team Sync",
  organizerId: "u-org",
  meetingType: "Team",
  meetingTypeLabel: null,
  attendanceMode: "Roster",
  projectId: "p1",
  selectedAt: new Date("2026-09-15T14:00:00Z"),
  durationMinutes: 60,
  status: "Confirmed",
  isCoreMeeting: false,
  meetingUrl: null,
  recurrenceRule: null,
  organizer: { firstName: "Alice", lastName: "Smith" },
  notePage: { id: "page1" },
  attendance: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("get_meeting", () => {
  it("requires mcp:read scope", () => {
    expect(GET_MEETING_DEF.requiredScope).toBe("mcp:read");
  });

  it("throws McpNotFoundError when meeting is missing", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(null);
    await expect(runGetMeeting("u1", { meetingId: "missing" })).rejects.toMatchObject({
      name: "McpNotFoundError",
    });
  });

  it("throws McpNotFoundError for Cancelled meeting", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      ...MEETING_BASE,
      status: "Cancelled",
    });
    await expect(runGetMeeting("u1", { meetingId: "m1" })).rejects.toMatchObject({
      name: "McpNotFoundError",
    });
  });

  it("throws McpForbiddenError for non-member with no attendance row", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(MEETING_BASE);
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);

    await expect(runGetMeeting("u-other", { meetingId: "m1" })).rejects.toMatchObject({
      name: "McpForbiddenError",
    });
  });

  it("returns full detail for organizer", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      ...MEETING_BASE,
      attendance: [
        {
          userId: "u2",
          present: true,
          markedAt: new Date("2026-09-15T14:05:00Z"),
          user: { firstName: "Bob", lastName: "Jones", daliEmail: "bob@dali.dartmouth.edu" },
        },
      ],
    });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);

    const out = await runGetMeeting("u-org", { meetingId: "m1" });
    expect(out.meetingId).toBe("m1");
    expect(out.title).toBe("Team Sync");
    expect(out.startsAt).toBe("2026-09-15T14:00:00.000Z");
    expect(out.durationMinutes).toBe(60);
    expect(out.typeLabel).toBe("Team");
    expect(out.notePageId).toBe("page1");
    expect(out.canManage).toBe(true);
    expect(out.roster).toHaveLength(1);
    expect(out.roster[0]).toMatchObject({
      userId: "u2",
      name: "Bob Jones",
      present: true,
      checkedInAt: "2026-09-15T14:05:00.000Z",
    });
  });

  it("allows an invited attendee to view but not manage", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      ...MEETING_BASE,
      attendance: [
        {
          userId: "u-attendee",
          present: false,
          markedAt: null,
          user: { firstName: "Carol", lastName: "Lee", daliEmail: "carol@dali.dartmouth.edu" },
        },
      ],
    });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);

    const out = await runGetMeeting("u-attendee", { meetingId: "m1" });
    expect(out.canManage).toBe(false);
    expect(out.roster).toHaveLength(1);
  });

  it("uses meetingTypeLabel for Other type", async () => {
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({
      ...MEETING_BASE,
      meetingType: "Other",
      meetingTypeLabel: "Retrospective",
      projectId: null,
    });
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);

    const out = await runGetMeeting("u-core", { meetingId: "m1" });
    expect(out.typeLabel).toBe("Retrospective");
  });
});
