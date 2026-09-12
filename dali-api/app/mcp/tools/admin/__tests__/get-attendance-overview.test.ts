import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    term: { findUnique: vi.fn() },
    scheduledMeeting: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  runGetAttendanceOverview,
  GET_ATTENDANCE_OVERVIEW_TOOL,
} from "~/mcp/tools/admin/get-attendance-overview";
import type { McpCtx } from "~/mcp/registry";

function makeCtx(userId = "u-core"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Core",
      lastName: "Lead",
    },
    scopes: ["mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

const MEETING_ROW = {
  id: "meet-1",
  title: "Weekly Sync",
  selectedAt: new Date("2026-09-10T14:00:00Z"),
  meetingType: "TeamMeeting",
  meetingTypeLabel: null,
  project: { id: "proj-1", name: "DALI App" },
  organizer: { firstName: "Alice", lastName: "Smith", daliEmail: "alice@dali.dartmouth.edu" },
  attendance: [
    {
      present: true,
      markedAt: new Date("2026-09-10T14:05:00Z"),
      user: { id: "u-1", firstName: "Bob", lastName: "Jones", daliEmail: "bob@dali.dartmouth.edu" },
    },
    {
      present: false,
      markedAt: null,
      user: { id: "u-2", firstName: "Carol", lastName: "Lee", daliEmail: "carol@dali.dartmouth.edu" },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  (prisma.scheduledMeeting.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([MEETING_ROW]);
  (prisma.term.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe("get_attendance_overview", () => {
  it("requires mcp:admin scope", () => {
    expect(GET_ATTENDANCE_OVERVIEW_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(runGetAttendanceOverview(makeCtx("u-nobody"), {})).rejects.toMatchObject({
      name: "McpForbiddenError",
      status: 403,
    });
    expect(prisma.scheduledMeeting.findMany).not.toHaveBeenCalled();
  });

  it("returns meetings with computed check-in rates on happy path", async () => {
    const out = await runGetAttendanceOverview(makeCtx(), {});
    expect(out.termId).toBeNull();
    expect(out.total).toBe(1);
    expect(out.events[0]).toMatchObject({
      id: "meet-1",
      title: "Weekly Sync",
      invited: 2,
      checkedIn: 1,
      checkInRate: 50,
      projectId: "proj-1",
      projectName: "DALI App",
      organizerName: "Alice Smith",
      startsAt: "2026-09-10T14:00:00.000Z",
    });
  });

  it("includes attendee list with presence flags", async () => {
    const out = await runGetAttendanceOverview(makeCtx(), {});
    const attendees = out.events[0].attendees;
    expect(attendees).toHaveLength(2);
    expect(attendees[0]).toMatchObject({
      id: "u-1",
      name: "Bob Jones",
      present: true,
      markedAt: "2026-09-10T14:05:00.000Z",
    });
    expect(attendees[1]).toMatchObject({
      id: "u-2",
      name: "Carol Lee",
      present: false,
      markedAt: null,
    });
  });

  it("returns null checkInRate when no attendees", async () => {
    (prisma.scheduledMeeting.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...MEETING_ROW, attendance: [] },
    ]);
    const out = await runGetAttendanceOverview(makeCtx(), {});
    expect(out.events[0].checkInRate).toBeNull();
    expect(out.events[0].invited).toBe(0);
  });

  it("applies term date filter when termId is provided and term exists", async () => {
    const termStart = new Date("2026-09-01");
    const termEnd = new Date("2026-12-15");
    (prisma.term.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      startDate: termStart,
      endDate: termEnd,
    });

    await runGetAttendanceOverview(makeCtx(), { termId: "term-26F" });

    expect(prisma.scheduledMeeting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          selectedAt: { gte: termStart, lte: termEnd },
        }),
      }),
    );
    expect(prisma.term.findUnique).toHaveBeenCalledWith({
      where: { id: "term-26F" },
      select: { startDate: true, endDate: true },
    });
  });

  it("uses Other meetingTypeLabel when meetingType is Other", async () => {
    (prisma.scheduledMeeting.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...MEETING_ROW, meetingType: "Other", meetingTypeLabel: "Game Night" },
    ]);
    const out = await runGetAttendanceOverview(makeCtx(), {});
    expect(out.events[0].typeLabel).toBe("Game Night");
  });

  it("returns empty events list when no meetings", async () => {
    (prisma.scheduledMeeting.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const out = await runGetAttendanceOverview(makeCtx(), {});
    expect(out.total).toBe(0);
    expect(out.events).toEqual([]);
  });
});
