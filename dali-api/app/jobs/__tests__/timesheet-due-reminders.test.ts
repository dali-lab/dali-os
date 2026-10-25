import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({
  notify: vi.fn().mockResolvedValue({ inApp: 0, emailed: 0, slackDmed: 0 }),
}));
vi.mock("~/lib/roles", () => ({
  currentTerm: vi.fn().mockResolvedValue({ id: "term-26f" }),
}));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { currentTerm } from "~/lib/roles";
import { JOBS } from "~/jobs/registry";
import {
  paidRoleUserIds,
  runTimesheetDueReminders,
  TIMESHEET_LINK,
} from "~/jobs/timesheet-due-reminders.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;
const mockCurrentTerm = currentTerm as unknown as ReturnType<typeof vi.fn>;

// Pay period Oct 11 – Oct 24, 2026 (index 7 from the Jul 5 anchor). Its last
// day is Saturday Oct 24; the default reminder day is Friday Oct 23. EDT, so
// 10:30 ET is 14:30 UTC.
const FRIDAY_1030_ET = new Date("2026-10-23T14:30:00Z");
const FRIDAY_0930_ET = new Date("2026-10-23T13:30:00Z");
const SATURDAY_1030_ET = new Date("2026-10-24T14:30:00Z");
const THURSDAY_1030_ET = new Date("2026-10-22T14:30:00Z");
// Friday Oct 23 at 23:30 ET is already Saturday Oct 24 in UTC.
const FRIDAY_LATE_ET = new Date("2026-10-24T03:30:00Z");

const DEFAULTS = { daysBeforeEnd: 1, sendHourEt: 10 };

function users(...ids: string[]) {
  return ids.map((userId) => ({ userId }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentTerm.mockResolvedValue({ id: "term-26f" });
  mockPrisma.projectAssignment.findMany.mockResolvedValue(users("u1", "u2"));
  mockPrisma.coreAssignment.findMany.mockResolvedValue(users("u2", "u3"));
  mockPrisma.instructorAssignment.findMany.mockResolvedValue(users("u4"));
  mockPrisma.domainLeadAssignment.findMany.mockResolvedValue(users("u1"));
  mockPrisma.customHire.findMany.mockResolvedValue(users("u5"));
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockNotify.mockResolvedValue({ inApp: 5, emailed: 0, slackDmed: 0 });
});

describe("paidRoleUserIds", () => {
  it("unions every paid role table for the current term and dedupes users", async () => {
    const ids = await paidRoleUserIds();
    expect(ids.sort()).toEqual(["u1", "u2", "u3", "u4", "u5"]);
    for (const model of [
      "projectAssignment",
      "coreAssignment",
      "instructorAssignment",
      "domainLeadAssignment",
    ]) {
      expect(mockPrisma[model]!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { termId: "term-26f" } }),
      );
    }
    expect(mockPrisma.customHire.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null } }),
    );
  });

  it("leaves out alumni who still hold a paid role row", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u3" }, { id: "u5" }]);
    const ids = await paidRoleUserIds();
    expect(ids.sort()).toEqual(["u1", "u2", "u4"]);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: expect.arrayContaining(["u1", "u2", "u3", "u4", "u5"]) }, membershipStatus: "Alumni" },
      }),
    );
  });

  it("skips the alumni lookup when nobody holds a paid role", async () => {
    mockCurrentTerm.mockResolvedValue(null);
    mockPrisma.customHire.findMany.mockResolvedValue([]);
    expect(await paidRoleUserIds()).toEqual([]);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("still includes custom hires when there is no current term", async () => {
    mockCurrentTerm.mockResolvedValue(null);
    const ids = await paidRoleUserIds();
    expect(ids).toEqual(["u5"]);
    expect(mockPrisma.projectAssignment.findMany).not.toHaveBeenCalled();
  });
});

describe("runTimesheetDueReminders", () => {
  it("notifies every paid member once the send hour passes on the reminder day", async () => {
    const result = await runTimesheetDueReminders({
      now: FRIDAY_1030_ET,
      lastSuccessAt: new Date("2026-10-23T13:45:00Z"), // previous tick, 9:45 ET, before the send hour
      settings: DEFAULTS,
    });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const args = mockNotify.mock.calls[0]![0];
    expect(args.eventType).toBe("timesheet.due_reminder");
    expect(args.message).toEqual({
      vars: { itemTitle: "Oct 11 – Oct 24" },
      link: TIMESHEET_LINK,
      dedupKey: "timesheet.due_reminder:7",
    });
    expect(args.recipients.map((r: { userId: string }) => r.userId).sort()).toEqual([
      "u1",
      "u2",
      "u3",
      "u4",
      "u5",
    ]);
    expect(result.items).toBe(5);
  });

  it("does nothing on days other than the reminder day", async () => {
    for (const now of [THURSDAY_1030_ET, SATURDAY_1030_ET]) {
      const result = await runTimesheetDueReminders({
        now,
        lastSuccessAt: null,
        settings: DEFAULTS,
      });
      expect(result.items).toBe(0);
    }
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does nothing before the send hour", async () => {
    const result = await runTimesheetDueReminders({
      now: FRIDAY_0930_ET,
      lastSuccessAt: null,
      settings: DEFAULTS,
    });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("does not send twice in one day", async () => {
    const result = await runTimesheetDueReminders({
      now: new Date("2026-10-23T14:45:00Z"),
      lastSuccessAt: FRIDAY_1030_ET,
      settings: DEFAULTS,
    });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("resolves the reminder day in ET, not UTC", async () => {
    // 23:30 ET Friday is Saturday in UTC; it is still the reminder day and the
    // send hour has long passed.
    const result = await runTimesheetDueReminders({
      now: FRIDAY_LATE_ET,
      lastSuccessAt: null,
      settings: DEFAULTS,
    });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(result.items).toBe(5);
  });

  it("honors daysBeforeEnd, so 0 means the period's last day", async () => {
    const result = await runTimesheetDueReminders({
      now: SATURDAY_1030_ET,
      lastSuccessAt: null,
      settings: { daysBeforeEnd: 0, sendHourEt: 10 },
    });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0]![0].message.dedupKey).toBe("timesheet.due_reminder:7");
    expect(result.items).toBe(5);
  });

  it("keys the dedup on the period, so the next fortnight is a fresh reminder", async () => {
    await runTimesheetDueReminders({
      // Friday before Sat Nov 7; EST by then, so 10:30 ET is 15:30 UTC.
      now: new Date("2026-11-06T15:30:00Z"),
      lastSuccessAt: null,
      settings: DEFAULTS,
    });
    expect(mockNotify.mock.calls[0]![0].message.dedupKey).toBe("timesheet.due_reminder:8");
    expect(mockNotify.mock.calls[0]![0].message.vars.itemTitle).toBe("Oct 25 – Nov 7");
  });

  it("skips the notify call when nobody holds a paid role", async () => {
    for (const model of [
      "projectAssignment",
      "coreAssignment",
      "instructorAssignment",
      "domainLeadAssignment",
      "customHire",
    ]) {
      mockPrisma[model]!.findMany.mockResolvedValue([]);
    }
    const result = await runTimesheetDueReminders({
      now: FRIDAY_1030_ET,
      lastSuccessAt: null,
      settings: DEFAULTS,
    });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });
});

describe("registry", () => {
  it("registers each job name exactly once", () => {
    const names = JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("registers timesheet-due-reminders with the Friday default", () => {
    const job = JOBS.find((j) => j.name === "timesheet-due-reminders");
    expect(job?.settings?.find((s) => s.key === "daysBeforeEnd")?.default).toBe(1);
    expect(job?.settings?.find((s) => s.key === "sendHourEt")?.default).toBe(10);
  });
});
