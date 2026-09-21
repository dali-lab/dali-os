import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/google-calendar", () => ({
  fetchBusyEvents: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "~/lib/db";
import { fetchBusyEvents } from "~/lib/google-calendar";
import {
  runOptimizeGroupMeetings,
  OPTIMIZE_GROUP_MEETINGS_DEF,
} from "~/mcp/tools/calendar-extra/optimize-group-meetings";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";

const mockPrisma = prisma as unknown as {
  user: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  groupDefinition: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  userAvailabilitySettings: { findUnique: ReturnType<typeof vi.fn> };
  workingHoursDay: { findMany: ReturnType<typeof vi.fn> };
  userCalendarLink: { findMany: ReturnType<typeof vi.fn> };
};
const mockFetchBusy = fetchBusyEvents as unknown as ReturnType<typeof vi.fn>;

// Mon 2026-05-11 00:00 ET → Sat 2026-05-16 00:00 ET (a five-weekday window).
const WINDOW_START = "2026-05-11T04:00:00Z";
const WINDOW_END = "2026-05-16T04:00:00Z";
const TZ = "America/New_York";

beforeEach(() => {
  vi.clearAllMocks();
  // Everyone: no persisted working hours (⇒ available all day), no calendar link.
  mockPrisma.userAvailabilitySettings.findUnique.mockResolvedValue(null);
  mockPrisma.workingHoursDay.findMany.mockResolvedValue([]);
  mockPrisma.userCalendarLink.findMany.mockResolvedValue([]);
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.groupDefinition.findMany.mockResolvedValue([]);
  mockFetchBusy.mockResolvedValue([]);
});

describe("optimize_group_meetings", () => {
  it("requires mcp:read", () => {
    expect(OPTIMIZE_GROUP_MEETINGS_DEF.requiredScope).toBe("mcp:read");
  });

  it("rejects windows > 14 days", async () => {
    await expect(
      runOptimizeGroupMeetings({
        meetings: [{ memberUserIds: ["u1"] }],
        windowStart: "2026-05-01T00:00:00Z",
        windowEnd: "2026-05-20T00:00:00Z",
        durationMinutes: 30,
        timezone: TZ,
      }),
    ).rejects.toThrow(/14 days/);
  });

  it("rejects a meeting with no members", async () => {
    await expect(
      runOptimizeGroupMeetings({
        meetings: [{}],
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        durationMinutes: 30,
        timezone: TZ,
      }),
    ).rejects.toThrow(/no members/);
  });

  it("rejects invalid slotMinutes", async () => {
    await expect(
      runOptimizeGroupMeetings({
        meetings: [{ memberUserIds: ["u1"] }],
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        durationMinutes: 30,
        slotMinutes: 20,
        timezone: TZ,
      }),
    ).rejects.toThrow(/slotMinutes/);
  });

  it("rejects duplicate meeting keys", async () => {
    await expect(
      runOptimizeGroupMeetings({
        meetings: [
          { key: "dup", memberUserIds: ["u1"] },
          { key: "dup", memberUserIds: ["u2"] },
        ],
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        durationMinutes: 30,
        timezone: TZ,
      }),
    ).rejects.toThrow(/Duplicate meeting key/);
  });

  it("schedules overlapping-membership meetings without double-booking a shared member", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", firstName: "Ann", lastName: "One", daliEmail: "a@x" },
      { id: "u2", firstName: "Bea", lastName: "Two", daliEmail: "b@x" },
      { id: "u3", firstName: "Cai", lastName: "Three", daliEmail: "c@x" },
    ]);

    const out = await runOptimizeGroupMeetings({
      meetings: [
        { key: "proj-a", memberUserIds: ["u1", "u2"] },
        { key: "staff", memberUserIds: ["u2", "u3"] },
      ],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      durationMinutes: 60,
      slotMinutes: 60,
      timezone: TZ,
    });

    expect(out.meetings).toHaveLength(2);
    expect(out.unscheduledMeetings).toHaveLength(0);
    for (const m of out.meetings) {
      expect(m.scheduled).toBe(true);
      expect(m.attendance.count).toBe(m.attendance.memberCount);
      expect(m.doubleBooked).toHaveLength(0);
      expect(m.attendance.percentage).toBe(100);
    }
    expect(out.totalAttendance).toBe(out.maxPossibleAttendance);
    expect(out.usersWithoutCalendar.sort()).toEqual(["u1", "u2", "u3"]);
    expect(out.participants["u2"].name).toBe("Bea Two");
    // No calendars ⇒ availability is assumed, and that must be surfaced.
    expect(out.notes.some((n) => /no linked calendar/i.test(n))).toBe(true);
  });

  it("marks a meeting unschedulable when a required member is never free", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "lead", firstName: "Lee", lastName: "Ad", daliEmail: "l@x" },
      { id: "u1", firstName: "Ann", lastName: "One", daliEmail: "a@x" },
    ]);
    mockFetchBusy.mockImplementation(async (userId: string) =>
      userId === "lead" ? [{ start: WINDOW_START, end: WINDOW_END }] : [],
    );

    const out = await runOptimizeGroupMeetings({
      meetings: [{ key: "sync", memberUserIds: ["u1"], requiredUserIds: ["lead"] }],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      durationMinutes: 30,
      timezone: TZ,
    });

    expect(out.unscheduledMeetings).toEqual(["sync"]);
    expect(out.meetings[0].scheduled).toBe(false);
    expect(out.meetings[0].slot).toBeNull();
    expect(out.notes.some((n) => /no viable slot/i.test(n))).toBe(true);
  });

  it("resolves members from a groupId", async () => {
    mockPrisma.groupDefinition.findMany.mockResolvedValue([{ id: "g1", name: "Design Team" }]);
    mockPrisma.groupDefinition.findUnique.mockResolvedValue({
      type: "Static",
      dynamicQuery: null,
      staticMemberIds: ["u1", "u2"],
    });
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", firstName: "Ann", lastName: "One", daliEmail: "a@x" },
      { id: "u2", firstName: "Bea", lastName: "Two", daliEmail: "b@x" },
    ]);

    const out = await runOptimizeGroupMeetings({
      meetings: [{ key: "design", groupId: "g1" }],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      durationMinutes: 30,
      timezone: TZ,
    });

    expect(out.meetings[0].label).toBe("Design Team");
    expect(out.meetings[0].memberCount).toBe(2);
    expect(out.meetings[0].scheduled).toBe(true);
  });

  it("validates schema shape", () => {
    const r = validateInput(
      { meetings: "not-an-array" },
      OPTIMIZE_GROUP_MEETINGS_DEF.inputSchema as JsonSchema,
    );
    expect(r.ok).toBe(false);
  });
});
