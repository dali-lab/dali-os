import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/calendar/lib/availability.server", async (orig) => {
  const real = await orig<typeof import("~/calendar/lib/availability.server")>();
  return { ...real, computeUserFreeBusy: vi.fn() };
});

import { computeUserFreeBusy } from "~/calendar/lib/availability.server";
import { FIND_FREE_TIMES_DEF, runFindFreeTimes } from "~/mcp/tools/calendar-extra/find-free-times";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";

const iv = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });
const user = (userId: string, over: Record<string, unknown> = {}) => ({
  userId,
  free: [],
  busy: [],
  working: [],
  hasCalendar: true,
  calendarError: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(computeUserFreeBusy).mockImplementation(async (id: string) => user(id) as never);
});

describe("find_free_times", () => {
  it("is a read tool that needs only a window", () => {
    expect(FIND_FREE_TIMES_DEF.requiredScope).toBe("mcp:read");
    expect(FIND_FREE_TIMES_DEF.inputSchema.required).toEqual(["start", "end"]);
    expect(validateInput({ start: "a", end: "b", detail: "other" }, FIND_FREE_TIMES_DEF.inputSchema as JsonSchema).ok).toBe(false);
  });

  it("rejects invalid dates, a reversed window and spans over 14 days", async () => {
    const base = { start: "2026-08-10T00:00:00Z", end: "2026-08-17T00:00:00Z" };
    await expect(runFindFreeTimes("u1", { ...base, start: "nope" })).rejects.toMatchObject({ name: "McpInvalidError" });
    await expect(runFindFreeTimes("u1", { start: base.end, end: base.start })).rejects.toThrow(/after start/);
    await expect(
      runFindFreeTimes("u1", { start: base.start, end: "2026-08-24T00:00:01Z" }),
    ).rejects.toThrow(/14 days/);
    expect(computeUserFreeBusy).not.toHaveBeenCalled();
    await expect(
      runFindFreeTimes("u1", { start: base.start, end: "2026-08-24T00:00:00Z" }),
    ).resolves.toHaveProperty("slots");
  });

  it("includes the caller once when userIds is omitted or repeats the caller", async () => {
    await runFindFreeTimes("u1", { start: "2026-08-10T00:00:00Z", end: "2026-08-11T00:00:00Z" });
    expect(vi.mocked(computeUserFreeBusy).mock.calls.map((c) => c[0])).toEqual(["u1"]);
    vi.mocked(computeUserFreeBusy).mockClear();
    await runFindFreeTimes("u1", { userIds: ["u2", "u1", "u2"], start: "2026-08-10T00:00:00Z", end: "2026-08-11T00:00:00Z" });
    expect(vi.mocked(computeUserFreeBusy).mock.calls.map((c) => c[0])).toEqual(["u1", "u2"]);
  });

  it("slots lists intersections of at least durationMinutes", async () => {
    vi.mocked(computeUserFreeBusy).mockImplementation(async (id: string) =>
      user(id, {
        free:
          id === "u1"
            ? [iv("2026-08-10T13:00:00Z", "2026-08-10T15:00:00Z")]
            : [iv("2026-08-10T14:00:00Z", "2026-08-10T14:20:00Z"), iv("2026-08-10T14:30:00Z", "2026-08-10T16:00:00Z")],
      }) as never,
    );
    const out = await runFindFreeTimes("u1", {
      userIds: ["u2"],
      start: "2026-08-10T13:00:00Z",
      end: "2026-08-10T17:00:00Z",
      durationMinutes: 30,
    });
    expect(out).toEqual({
      slots: [{ start: "2026-08-10T14:30:00.000Z", end: "2026-08-10T15:00:00.000Z" }],
      truncated: false,
    });
  });

  it("full returns day buckets plus each user's free, busy and working intervals", async () => {
    const work = iv("2026-08-10T13:00:00Z", "2026-08-10T21:00:00Z");
    const free = iv("2026-08-10T13:00:00Z", "2026-08-10T15:00:00Z");
    vi.mocked(computeUserFreeBusy).mockResolvedValue(
      user("u1", { free: [free], busy: [iv("2026-08-10T15:00:00Z", "2026-08-10T21:00:00Z")], working: [work], hasCalendar: false, calendarError: true }) as never,
    );
    const out = (await runFindFreeTimes("u1", {
      start: "2026-08-10T04:00:00Z",
      end: "2026-08-17T04:00:00Z",
      timezone: "America/New_York",
      detail: "full",
    })) as { days: { dayKey: string; matches: unknown[]; busy: unknown[]; working: unknown[] }[]; perUser: Record<string, unknown>[]; truncated: boolean };
    expect(out.perUser).toEqual([
      {
        userId: "u1",
        free: [{ startIso: "2026-08-10T13:00:00.000Z", endIso: "2026-08-10T15:00:00.000Z" }],
        busy: [{ startIso: "2026-08-10T15:00:00.000Z", endIso: "2026-08-10T21:00:00.000Z" }],
        working: [{ startIso: "2026-08-10T13:00:00.000Z", endIso: "2026-08-10T21:00:00.000Z" }],
        hasCalendar: false,
        calendarError: true,
      },
    ]);
    const monday = out.days.find((d) => d.dayKey === "2026-08-10");
    expect(monday?.matches).toEqual([{ startHour: 9, durationHours: 2 }]);
    expect(monday?.busy).toEqual([{ startHour: 11, durationHours: 6 }]);
    expect(monday?.working).toEqual([{ startHour: 9, durationHours: 8 }]);
    expect(out.truncated).toBe(false);
  });

  it.each(["slots", "full"] as const)("%s reports truncated when a calendar read hit its page bound", async (detail) => {
    vi.mocked(computeUserFreeBusy).mockImplementation(async (id: string, _s, _e, _tz, report) => {
      report!.truncated = true;
      return user(id) as never;
    });
    const out = await runFindFreeTimes("u1", { start: "2026-08-10T00:00:00Z", end: "2026-08-11T00:00:00Z", detail });
    expect(out.truncated).toBe(true);
  });
});
