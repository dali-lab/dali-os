import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/availability")>()),
  computeUserFreeBusy: vi.fn(),
}));
vi.mock("~/lib/shared-cache.server", () => ({
  sharedCacheGetMany: vi.fn(),
  sharedCacheSet: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { computeUserFreeBusy } from "~/lib/availability";
import { sharedCacheGetMany, sharedCacheSet } from "~/lib/shared-cache.server";
import { interviewerCalendars } from "~/hiring/lib/interview-availability.server";

const mockPrisma = prisma as unknown as Record<string, any>;

// Mon 5 Jan 2099 through Sun 11 Jan 2099, 9 to 10 AM Eastern (UTC-5 in January).
const config = {
  interviewStartDate: new Date("2099-01-05T00:00:00Z"),
  interviewEndDate: new Date("2099-01-11T00:00:00Z"),
  timezone: "America/New_York",
  dayStartHour: 9,
  dayEndHour: 10,
};
const at = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2099, 0, day, hh + 5, mm));

function freeBusy(free: { start: Date; end: Date }[], hasCalendar: boolean) {
  return { userId: "u", free, busy: [], working: [], hasCalendar, calendarError: false };
}

const stored = (readAt: number) =>
  JSON.stringify({
    readAt,
    calendar: {
      hasCalendar: true,
      hasWorkingHours: false,
      available: [{ startTime: at(5, 9).toISOString(), endTime: at(5, 10).toISOString() }],
    },
  });

let n = 0;
beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.workingHoursDay = { findFirst: vi.fn().mockResolvedValue(null) };
  vi.mocked(sharedCacheGetMany).mockImplementation(async (keys) => keys.map(() => null));
  n += 1; // fresh user per test, so the short-lived cache never carries over
});

describe("interviewerCalendars", () => {
  it("limits free time to the interview window's weekdays and daily hours", async () => {
    const user = `u${n}`;
    vi.mocked(computeUserFreeBusy).mockResolvedValue(
      freeBusy([{ start: at(5, 8), end: at(10, 12) }], true), // Mon 8am through Sat noon
    );
    const cal = (await interviewerCalendars([user], config)).get(user)!;
    // Mon–Fri, 9 to 10 each day; the Saturday stretch is dropped.
    expect(cal.available.map((b) => [b.startTime, b.endTime])).toEqual(
      [5, 6, 7, 8, 9].map((d) => [at(d, 9), at(d, 10)]),
    );
  });

  it("treats someone with no linked calendar and no working hours as unavailable", async () => {
    const user = `u${n}`;
    vi.mocked(computeUserFreeBusy).mockResolvedValue(
      freeBusy([{ start: at(5, 0), end: at(12, 0) }], false), // "free" around the clock
    );
    const cal = (await interviewerCalendars([user], config)).get(user)!;
    expect(cal).toEqual({ hasCalendar: false, hasWorkingHours: false, available: [] });
  });

  it("trusts working hours when no calendar is linked", async () => {
    const user = `u${n}`;
    mockPrisma.workingHoursDay.findFirst.mockResolvedValue({ id: "wh" });
    vi.mocked(computeUserFreeBusy).mockResolvedValue(
      freeBusy([{ start: at(5, 9, 30), end: at(5, 10) }], false),
    );
    const cal = (await interviewerCalendars([user], config)).get(user)!;
    expect(cal.hasWorkingHours).toBe(true);
    expect(cal.available).toEqual([{ startTime: at(5, 9, 30), endTime: at(5, 10) }]);
  });

  it("reads each calendar once for back-to-back lookups", async () => {
    const user = `u${n}`;
    vi.mocked(computeUserFreeBusy).mockResolvedValue(freeBusy([], true));
    await interviewerCalendars([user, user], config);
    await interviewerCalendars([user], config);
    expect(computeUserFreeBusy).toHaveBeenCalledTimes(1);
  });

  it("uses a calendar another machine read instead of reading it again", async () => {
    const user = `u${n}`;
    vi.mocked(sharedCacheGetMany).mockResolvedValue([stored(Date.now())]);
    const cal = (await interviewerCalendars([user], config)).get(user)!;
    expect(computeUserFreeBusy).not.toHaveBeenCalled();
    expect(cal).toEqual({
      hasCalendar: true,
      hasWorkingHours: false,
      available: [{ startTime: at(5, 9), endTime: at(5, 10) }],
    });
  });

  it("shares a calendar it read for two minutes", async () => {
    const user = `u${n}`;
    vi.mocked(computeUserFreeBusy).mockResolvedValue(
      freeBusy([{ start: at(5, 9), end: at(5, 10) }], true),
    );
    await interviewerCalendars([user], config);
    expect(sharedCacheSet).toHaveBeenCalledTimes(1);
    const [key, value, ttl] = vi.mocked(sharedCacheSet).mock.calls[0];
    expect(key).toContain(user);
    expect(ttl).toBe(120_000);
    expect(JSON.parse(value).calendar.available).toEqual([
      { startTime: at(5, 9).toISOString(), endTime: at(5, 10).toISOString() },
    ]);
  });

  it("reads only the calendars no machine has", async () => {
    const [known, unknown] = [`u${n}a`, `u${n}b`];
    vi.mocked(sharedCacheGetMany).mockResolvedValue([stored(Date.now()), null]);
    vi.mocked(computeUserFreeBusy).mockResolvedValue(freeBusy([], true));
    await interviewerCalendars([known, unknown], config);
    expect(computeUserFreeBusy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(computeUserFreeBusy).mock.calls[0][0]).toBe(unknown);
  });

  it("expires a shared calendar on its original schedule, not from when it arrived here", async () => {
    const user = `u${n}`;
    const realNow = Date.now();
    vi.mocked(sharedCacheGetMany).mockResolvedValue([stored(realNow - 110_000)]);
    await interviewerCalendars([user], config);
    vi.mocked(sharedCacheGetMany).mockResolvedValue([null]);
    vi.mocked(computeUserFreeBusy).mockResolvedValue(freeBusy([], true));
    const clock = vi.spyOn(Date, "now").mockReturnValue(realNow + 20_000);
    await interviewerCalendars([user], config);
    clock.mockRestore();
    expect(computeUserFreeBusy).toHaveBeenCalledTimes(1);
  });

  it("reads at most six calendars at once", async () => {
    let running = 0;
    let peak = 0;
    vi.mocked(computeUserFreeBusy).mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running -= 1;
      return freeBusy([], true);
    });
    const users = Array.from({ length: 20 }, (_, i) => `u${n}-${i}`);
    vi.mocked(sharedCacheGetMany).mockResolvedValue(users.map(() => null));
    const calendars = await interviewerCalendars(users, config);
    expect(calendars.size).toBe(20);
    expect(peak).toBe(6);
  });

  it("reads again after a failed read", async () => {
    const user = `u${n}`;
    vi.mocked(computeUserFreeBusy).mockRejectedValueOnce(new Error("google down"));
    await expect(interviewerCalendars([user], config)).rejects.toThrow("google down");
    expect(sharedCacheSet).not.toHaveBeenCalled();
    vi.mocked(computeUserFreeBusy).mockResolvedValue(freeBusy([], true));
    await expect(interviewerCalendars([user], config)).resolves.toBeInstanceOf(Map);
  });
});
