import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    term: { findUnique: vi.fn() },
    scheduledMeeting: { findMany: vi.fn(), count: vi.fn() },
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
      occurrenceStart: new Date("2026-09-10T14:00:00Z"),
      present: true,
      markedAt: new Date("2026-09-10T14:05:00Z"),
      user: { id: "u-1", firstName: "Bob", lastName: "Jones", daliEmail: "bob@dali.dartmouth.edu" },
    },
    {
      occurrenceStart: new Date("2026-09-10T14:00:00Z"),
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
  (prisma.scheduledMeeting.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
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
    expect(out.page).toEqual({ nextCursor: null, hasMore: false, limit: 100, total: 1 });
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
    const attendees = out.events[0].attendees!;
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

  it("labels a typeless meeting \"Meeting\" instead of dropping it", async () => {
    (prisma.scheduledMeeting.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...MEETING_ROW, meetingType: null },
    ]);
    const out = await runGetAttendanceOverview(makeCtx(), {});
    expect(out.events[0].typeLabel).toBe("Meeting");
  });

  it("returns empty events list when no meetings", async () => {
    (prisma.scheduledMeeting.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const out = await runGetAttendanceOverview(makeCtx(), {});
    expect(out.page.hasMore).toBe(false);
    expect(out.events).toEqual([]);
  });

  it("sorts undated meetings last and breaks ties on id", async () => {
    await runGetAttendanceOverview(makeCtx(), {});
    const call = (prisma.scheduledMeeting.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.orderBy).toEqual([
      { selectedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "asc" },
    ]);
  });

  it("walks pages with the cursor and ends with a null cursor", async () => {
    const findMany = prisma.scheduledMeeting.findMany as ReturnType<typeof vi.fn>;
    const count = prisma.scheduledMeeting.count as ReturnType<typeof vi.fn>;
    count.mockResolvedValue(3);
    const m = (id: string) => ({ ...MEETING_ROW, id });
    findMany.mockResolvedValueOnce([m("meet-1"), m("meet-2"), m("meet-3")]);

    const first = await runGetAttendanceOverview(makeCtx(), { limit: 2 });
    expect(first.events.map((e) => e.id)).toEqual(["meet-1", "meet-2"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2, total: 3 });
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 3 });

    findMany.mockResolvedValueOnce([m("meet-3")]);
    const second = await runGetAttendanceOverview(makeCtx(), { limit: 2, cursor: first.page.nextCursor! });
    expect(second.events.map((e) => e.id)).toEqual(["meet-3"]);
    expect(second.page).toEqual({ nextCursor: null, hasMore: false, limit: 2, total: 3 });
    expect(findMany.mock.calls[1][0]).toMatchObject({ skip: 2, take: 3 });
  });

  it("counts every matching meeting, not the page length", async () => {
    (prisma.scheduledMeeting.count as ReturnType<typeof vi.fn>).mockResolvedValue(480);
    const out = await runGetAttendanceOverview(makeCtx(), {});
    expect(out.page.total).toBe(480);
    expect(out).not.toHaveProperty("total");
  });

  it("returns counts without attendee rows when includeAttendees is false", async () => {
    (prisma.scheduledMeeting.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...MEETING_ROW, attendance: [{ present: true }, { present: false }, { present: true }] },
    ]);
    const out = await runGetAttendanceOverview(makeCtx(), { includeAttendees: false });
    expect(out.events[0]).toMatchObject({ invited: 3, checkedIn: 2, checkInRate: 67 });
    expect(out.events[0]).not.toHaveProperty("attendees");
    const call = (prisma.scheduledMeeting.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.select.attendance).toEqual({ select: { present: true } });
  });
});
