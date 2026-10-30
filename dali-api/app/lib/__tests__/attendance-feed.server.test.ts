import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    scheduledMeeting: { findMany: vi.fn() },
    meetingException: { findMany: vi.fn() },
    meetingAttendance: { groupBy: vi.fn() },
    projectAssignment: { findMany: vi.fn() },
  },
}));

vi.mock("~/lib/db", () => ({ prisma: db }));
vi.mock("~/lib/display", () => ({
  fullName: (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`,
}));

import { loadAttendanceFeed, OLDER_PAGE_SIZE } from "../attendance-feed.server";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const viewer = { userId: "viewer", core: false };

function attendanceRow(occurrenceStart: Date, userId = "ada", absenceNote: string | null = null) {
  return {
    occurrenceStart,
    present: true,
    markedAt: null,
    absenceNote,
    userId,
    user: { id: userId, firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" },
  };
}

function meeting(id: string, attendance: ReturnType<typeof attendanceRow>[], extra: object = {}) {
  return {
    id,
    title: `Meeting ${id}`,
    selectedAt: hoursAgo(1000),
    durationMinutes: 60,
    meetingType: "Standup",
    meetingTypeLabel: null,
    isCoreMeeting: false,
    organizerId: "organizer",
    project: null,
    organizer: { firstName: "Grace", lastName: "Hopper", daliEmail: "grace@example.edu" },
    exceptions: [],
    attendance,
    ...extra,
  };
}

function setup(detail: ReturnType<typeof meeting>[], olderKeys: object[], currentMeetingIds: string[] = []) {
  db.scheduledMeeting.findMany.mockImplementation(async (args: { select: { title?: boolean } }) =>
    args.select.title ? detail : detail.map((m) => ({ id: m.id })),
  );
  db.meetingAttendance.groupBy.mockImplementation(async (args: { by: string[] }) =>
    args.by.length === 2 ? olderKeys : currentMeetingIds.map((scheduledMeetingId) => ({ scheduledMeetingId })),
  );
}

const olderCall = () =>
  db.meetingAttendance.groupBy.mock.calls.map((c) => c[0]).find((a) => a.by.length === 2);
const currentCall = () =>
  db.meetingAttendance.groupBy.mock.calls.map((c) => c[0]).find((a) => a.by.length === 1);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.clearAllMocks();
  db.meetingException.findMany.mockResolvedValue([]);
  db.projectAssignment.findMany.mockResolvedValue([]);
});

describe("loadAttendanceFeed", () => {
  it("returns nothing when the viewer has no meetings", async () => {
    setup([], []);
    await expect(loadAttendanceFeed(viewer, {})).resolves.toEqual({ items: [], nextCursor: null });
    expect(db.meetingAttendance.groupBy).not.toHaveBeenCalled();
  });

  it("scopes visibility to meetings the viewer organizes or is invited to", async () => {
    setup([], []);
    await loadAttendanceFeed(viewer, {});
    const where = db.scheduledMeeting.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ not: "Cancelled" });
    expect(where.AND[0]).toEqual({
      OR: [{ organizerId: "viewer" }, { participantUserIds: { has: "viewer" } }],
    });
  });

  it("keeps recent and unscheduled occurrences in the current set", async () => {
    setup([meeting("m1", [attendanceRow(hoursAgo(1))])], [], ["m1"]);
    await loadAttendanceFeed(viewer, {});
    expect(currentCall().where.OR).toEqual(
      expect.arrayContaining([
        { occurrenceStart: { gte: hoursAgo(24) } },
        { meeting: { selectedAt: null } },
      ]),
    );
  });

  it("moves a rescheduled occurrence out of history and into the current set", async () => {
    const original = hoursAgo(500);
    setup([meeting("m1", [attendanceRow(original)])], [], ["m1"]);
    db.meetingException.findMany.mockResolvedValue([{ scheduledMeetingId: "m1", originalStart: original }]);
    await loadAttendanceFeed(viewer, {});
    const key = { scheduledMeetingId: "m1", occurrenceStart: original };
    expect(currentCall().where.OR).toContainEqual(key);
    expect(JSON.stringify(olderCall().where)).toContain('"NOT"');
    expect(olderCall().where.AND[0].NOT).toEqual({ OR: [key] });
  });

  it("marks only ended occurrences as past, and leaves unscheduled ones upcoming", async () => {
    setup(
      [
        meeting("ended", [attendanceRow(hoursAgo(2))]),
        meeting("unscheduled", [attendanceRow(hoursAgo(1))], { selectedAt: null }),
      ],
      [],
      ["ended", "unscheduled"],
    );
    const { items } = await loadAttendanceFeed(viewer, {});
    const byId = Object.fromEntries(items.map((c) => [c.meetingId, c]));
    expect(byId.ended.isPast).toBe(true);
    expect(byId.unscheduled).toMatchObject({ isPast: false, startsAt: null });
  });

  it("drops a cancelled occurrence", async () => {
    const start = hoursAgo(2);
    setup(
      [meeting("m1", [attendanceRow(start)], { exceptions: [{ originalStart: start, overrideStart: null, cancelled: true }] })],
      [],
      ["m1"],
    );
    await expect(loadAttendanceFeed(viewer, {})).resolves.toMatchObject({ items: [] });
  });

  it("withholds absence notes from a viewer who cannot manage the event", async () => {
    setup([meeting("m1", [attendanceRow(hoursAgo(2), "ada", "excused")])], [], ["m1"]);
    const { items } = await loadAttendanceFeed(viewer, {});
    expect(items[0].canManage).toBe(false);
    expect(items[0].attendees[0].absenceNote).toBeNull();
  });

  it.each([
    ["the organizer", { userId: "organizer", core: false }],
    ["Core", { userId: "viewer", core: true }],
  ])("shows absence notes to %s", async (_label, who) => {
    setup([meeting("m1", [attendanceRow(hoursAgo(2), "ada", "excused")])], [], ["m1"]);
    const { items } = await loadAttendanceFeed(who, {});
    expect(items[0].attendees[0].absenceNote).toBe("excused");
  });

  it("shows absence notes to a member of the event's project", async () => {
    db.projectAssignment.findMany.mockResolvedValue([{ projectId: "p1" }]);
    setup(
      [meeting("m1", [attendanceRow(hoursAgo(2), "ada", "excused")], { project: { id: "p1", name: "Alpha" } })],
      [],
      ["m1"],
    );
    const { items } = await loadAttendanceFeed(viewer, {});
    expect(items[0]).toMatchObject({ canManage: true, canEdit: false, scope: "Alpha" });
  });

  describe("older pages", () => {
    const keys = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        scheduledMeetingId: `m${i}`,
        occurrenceStart: hoursAgo(100 + i),
      }));

    it("overfetches one key and returns a cursor at the last kept key", async () => {
      const raw = keys(OLDER_PAGE_SIZE + 1);
      setup([meeting("m0", [attendanceRow(raw[0].occurrenceStart)])], raw);
      const { nextCursor } = await loadAttendanceFeed(viewer, { cursor: "" });
      expect(olderCall().take).toBe(OLDER_PAGE_SIZE + 1);
      const last = raw[OLDER_PAGE_SIZE - 1];
      expect(nextCursor).toBe(`${last.occurrenceStart.toISOString()}|${last.scheduledMeetingId}`);
    });

    it("continues strictly after the cursor", async () => {
      setup([meeting("m0", [])], []);
      const at = hoursAgo(100);
      await loadAttendanceFeed(viewer, { cursor: `${at.toISOString()}|m5` });
      expect(olderCall().where.AND[1]).toEqual({
        OR: [{ occurrenceStart: { lt: at } }, { occurrenceStart: at, scheduledMeetingId: { lt: "m5" } }],
      });
    });

    it("reads a malformed cursor as the first older page", async () => {
      setup([meeting("m0", [])], []);
      await loadAttendanceFeed(viewer, { cursor: "garbage" });
      expect(olderCall().where.AND[1]).toEqual({});
    });

    it("keeps paging when every occurrence on a page was cancelled", async () => {
      const raw = keys(OLDER_PAGE_SIZE + 1);
      const start = raw[0].occurrenceStart;
      setup(
        [meeting("m0", [attendanceRow(start)], { exceptions: [{ originalStart: start, overrideStart: null, cancelled: true }] })],
        raw,
      );
      const { items, nextCursor } = await loadAttendanceFeed(viewer, { cursor: "" });
      expect(items).toEqual([]);
      expect(nextCursor).not.toBeNull();
    });

    it("returns only history when given a cursor, without reloading the current set", async () => {
      setup([meeting("m0", [])], []);
      await loadAttendanceFeed(viewer, { cursor: "" });
      expect(currentCall()).toBeUndefined();
    });
  });

  describe("search", () => {
    it("searches the title and attendee names on the server", async () => {
      setup([], []);
      await loadAttendanceFeed(viewer, { q: "  ada " });
      const search = db.scheduledMeeting.findMany.mock.calls[0][0].where.AND[2].OR;
      const contains = { contains: "ada", mode: "insensitive" };
      expect(search).toContainEqual({ title: contains });
      expect(JSON.stringify(search)).toContain('"attendance"');
    });

    it("adds no search clause for a blank query", async () => {
      setup([], []);
      await loadAttendanceFeed(viewer, { q: "   " });
      expect(db.scheduledMeeting.findMany.mock.calls[0][0].where.AND).toHaveLength(2);
    });
  });
});
