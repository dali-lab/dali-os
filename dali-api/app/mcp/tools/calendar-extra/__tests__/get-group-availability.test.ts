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
vi.mock("~/lib/db.server");
vi.mock("~/lib/availability", async (orig) => {
  const real = await orig<typeof import("~/lib/availability")>();
  return { ...real, computeUserFreeBusy: vi.fn() };
});
vi.mock("~/lib/timezone", async (orig) => {
  const real = await orig<typeof import("~/lib/timezone")>();
  return { ...real };
});

import { computeUserFreeBusy } from "~/lib/availability";
import {
  runGetGroupAvailability,
  GET_GROUP_AVAILABILITY_DEF,
} from "~/mcp/tools/calendar-extra/get-group-availability";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("get_group_availability", () => {
  it("requires the mcp:read scope", () => {
    expect(GET_GROUP_AVAILABILITY_DEF.requiredScope).toBe("mcp:read");
  });

  it("throws McpInvalidError when dates are invalid", async () => {
    await expect(
      runGetGroupAvailability({
        userIds: ["u1"],
        weekStartIso: "not-a-date",
        weekEndIso: "2026-08-10T00:00:00Z",
        durationMinutes: 30,
        timezone: "America/New_York",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpInvalidError when end is before start", async () => {
    await expect(
      runGetGroupAvailability({
        userIds: ["u1"],
        weekStartIso: "2026-08-10T00:00:00Z",
        weekEndIso: "2026-08-09T00:00:00Z",
        durationMinutes: 30,
        timezone: "America/New_York",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("rejects a window longer than 14 days and accepts exactly 14", async () => {
    vi.mocked(computeUserFreeBusy).mockResolvedValue({
      userId: "u1", free: [], busy: [], working: [], hasCalendar: true, calendarError: false,
    });
    const base = { userIds: ["u1"], durationMinutes: 30, timezone: "America/New_York" };
    await expect(
      runGetGroupAvailability({ ...base, weekStartIso: "2026-08-10T00:00:00Z", weekEndIso: "2026-08-24T00:00:01Z" }),
    ).rejects.toThrow(/14 days/);
    expect(computeUserFreeBusy).not.toHaveBeenCalled();
    await expect(
      runGetGroupAvailability({ ...base, weekStartIso: "2026-08-10T00:00:00Z", weekEndIso: "2026-08-24T00:00:00Z" }),
    ).resolves.toHaveProperty("days");
  });

  it("returns days and perUser arrays on success", async () => {
    vi.mocked(computeUserFreeBusy).mockResolvedValue({
      userId: "u1",
      free: [],
      busy: [],
      working: [],
      hasCalendar: true,
      calendarError: false,
    });

    const out = await runGetGroupAvailability({
      userIds: ["u1"],
      weekStartIso: "2026-08-10T00:00:00Z",
      weekEndIso: "2026-08-17T00:00:00Z",
      durationMinutes: 30,
      timezone: "America/New_York",
    });

    expect(out).toHaveProperty("days");
    expect(out).toHaveProperty("perUser");
    expect(Array.isArray(out.days)).toBe(true);
    expect(Array.isArray(out.perUser)).toBe(true);
    expect(out.perUser[0]).toMatchObject({ userId: "u1", free: [] });
  });

  it("returns per-user working hours and the shared working hours per day", async () => {
    const monWork = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T21:00:00Z") };
    const monFree = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T15:00:00Z") };
    vi.mocked(computeUserFreeBusy).mockResolvedValue({
      userId: "u1",
      free: [monFree],
      busy: [{ start: monFree.end, end: monWork.end }],
      working: [monWork],
      hasCalendar: true,
      calendarError: false,
    });

    const out = await runGetGroupAvailability({
      userIds: ["u1"],
      weekStartIso: "2026-08-10T04:00:00Z",
      weekEndIso: "2026-08-17T04:00:00Z",
      durationMinutes: 30,
      timezone: "America/New_York",
    });

    expect(out.perUser[0].working).toEqual([
      { startIso: "2026-08-10T13:00:00.000Z", endIso: "2026-08-10T21:00:00.000Z" },
    ]);
    const monday = out.days.find((d) => d.dayKey === "2026-08-10");
    expect(monday?.working).toEqual([{ startHour: 9, durationHours: 8 }]);
    expect(monday?.matches).toEqual([{ startHour: 9, durationHours: 2 }]);
    expect(monday?.busy).toEqual([{ startHour: 11, durationHours: 6 }]);
  });
});
