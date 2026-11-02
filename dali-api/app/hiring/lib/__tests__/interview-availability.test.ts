import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/availability")>()),
  computeUserFreeBusy: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { computeUserFreeBusy } from "~/lib/availability";
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

let n = 0;
beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.workingHoursDay = { findFirst: vi.fn().mockResolvedValue(null) };
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

  it("reads only the calendars it doesn't already hold", async () => {
    const [held, fresh] = [`u${n}a`, `u${n}b`];
    vi.mocked(computeUserFreeBusy).mockResolvedValue(freeBusy([], true));
    await interviewerCalendars([held], config);
    vi.mocked(computeUserFreeBusy).mockClear();
    await interviewerCalendars([held, fresh], config);
    expect(computeUserFreeBusy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(computeUserFreeBusy).mock.calls[0][0]).toBe(fresh);
  });

  it("reads a calendar again once it is over two minutes old", async () => {
    const user = `u${n}`;
    vi.mocked(computeUserFreeBusy).mockResolvedValue(freeBusy([], true));
    await interviewerCalendars([user], config);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_001);
    await interviewerCalendars([user], config);
    clock.mockRestore();
    expect(computeUserFreeBusy).toHaveBeenCalledTimes(2);
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
    const calendars = await interviewerCalendars(users, config);
    expect(calendars.size).toBe(20);
    expect(peak).toBe(6);
  });

  it("reads again after a failed read", async () => {
    const user = `u${n}`;
    vi.mocked(computeUserFreeBusy).mockRejectedValueOnce(new Error("google down"));
    await expect(interviewerCalendars([user], config)).rejects.toThrow("google down");
    vi.mocked(computeUserFreeBusy).mockResolvedValue(freeBusy([], true));
    await expect(interviewerCalendars([user], config)).resolves.toBeInstanceOf(Map);
  });
});
