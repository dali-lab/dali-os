import { describe, it, expect, vi } from "vitest";
vi.mock("~/lib/db.server", () => ({ prisma: {} }));
import { buildAvailabilityDays, unionIntervals } from "../availability-buckets.server";

const TZ = "America/New_York";

describe("buildAvailabilityDays", () => {
  it("intersects free intervals across users, keeping only windows >= durationMinutes", () => {
    // User A free 9am-12pm ET, user B free 10am-11am ET on the same day (UTC -4/-5
    // in early Nov is EST, -5h). Use a mid-November date so DST is settled (EST).
    const day = "2026-11-10"; // Tuesday
    const days = buildAvailabilityDays(
      [
        { free: [{ start: new Date(`${day}T14:00:00Z`), end: new Date(`${day}T17:00:00Z`) }], busy: [], working: [] },
        { free: [{ start: new Date(`${day}T15:00:00Z`), end: new Date(`${day}T16:00:00Z`) }], busy: [], working: [] },
      ],
      { durationMinutes: 30, timezone: TZ },
    );

    expect(days).toHaveLength(1);
    const bucket = days[0];
    expect(bucket.dayKey).toBe(day);
    expect(bucket.matches).toEqual([{ startHour: 10, durationHours: 1 }]);
  });

  it("drops a mutual window shorter than durationMinutes", () => {
    const day = "2026-11-10";
    const days = buildAvailabilityDays(
      [
        { free: [{ start: new Date(`${day}T14:00:00Z`), end: new Date(`${day}T14:20:00Z`) }], busy: [], working: [] },
      ],
      { durationMinutes: 30, timezone: TZ },
    );
    expect(days.flatMap((d) => d.matches)).toEqual([]);
  });

  it("buckets the busy union by day, independent of the matches", () => {
    const day = "2026-11-10";
    const days = buildAvailabilityDays(
      [
        {
          free: [],
          busy: [{ start: new Date(`${day}T14:00:00Z`), end: new Date(`${day}T15:00:00Z`) }],
          working: [],
        },
        {
          free: [],
          busy: [{ start: new Date(`${day}T14:30:00Z`), end: new Date(`${day}T16:00:00Z`) }],
          working: [],
        },
      ],
      { durationMinutes: 30, timezone: TZ },
    );
    expect(days).toHaveLength(1);
    // Union of 9-10am and 9:30-11am ET -> 9-11am (2h).
    expect(days[0].busy).toEqual([{ startHour: 9, durationHours: 2 }]);
  });

  it("splits a window spanning midnight into two day buckets", () => {
    const days = buildAvailabilityDays(
      [
        {
          free: [
            { start: new Date("2026-11-10T22:00:00-05:00"), end: new Date("2026-11-11T02:00:00-05:00") },
          ],
          busy: [],
          working: [],
        },
      ],
      { durationMinutes: 30, timezone: TZ },
    );
    expect(days.map((d) => d.dayKey)).toEqual(["2026-11-10", "2026-11-11"]);
    expect(days[0].matches).toEqual([{ startHour: 22, durationHours: 2 }]);
    expect(days[1].matches).toEqual([{ startHour: 0, durationHours: 2 }]);
  });

  it("buckets only the hours when every participant is working", () => {
    const day = "2026-11-10";
    const days = buildAvailabilityDays(
      [
        { free: [], busy: [], working: [{ start: new Date(`${day}T14:00:00Z`), end: new Date(`${day}T22:00:00Z`) }] },
        { free: [], busy: [], working: [{ start: new Date(`${day}T17:00:00Z`), end: new Date(`${day}T23:00:00Z`) }] },
      ],
      { durationMinutes: 30, timezone: TZ },
    );
    expect(days).toHaveLength(1);
    expect(days[0].working).toEqual([{ startHour: 12, durationHours: 5 }]);
    expect(days[0].matches).toEqual([]);
  });

  it("leaves working empty when one participant has no hours that day", () => {
    const day = "2026-11-10";
    const days = buildAvailabilityDays(
      [
        { free: [], busy: [], working: [{ start: new Date(`${day}T14:00:00Z`), end: new Date(`${day}T22:00:00Z`) }] },
        { free: [], busy: [], working: [] },
      ],
      { durationMinutes: 30, timezone: TZ },
    );
    expect(days.flatMap((d) => d.working)).toEqual([]);
  });

  it("returns no days when there are no participants", () => {
    expect(buildAvailabilityDays([], { durationMinutes: 30, timezone: TZ })).toEqual([]);
  });
});

describe("unionIntervals", () => {
  it("merges overlapping and adjacent intervals, leaves disjoint ones apart", () => {
    const out = unionIntervals([
      [{ start: new Date("2026-01-01T10:00:00Z"), end: new Date("2026-01-01T11:00:00Z") }],
      [{ start: new Date("2026-01-01T10:30:00Z"), end: new Date("2026-01-01T12:00:00Z") }],
      [{ start: new Date("2026-01-01T14:00:00Z"), end: new Date("2026-01-01T15:00:00Z") }],
    ]);
    expect(out).toEqual([
      { start: new Date("2026-01-01T10:00:00Z"), end: new Date("2026-01-01T12:00:00Z") },
      { start: new Date("2026-01-01T14:00:00Z"), end: new Date("2026-01-01T15:00:00Z") },
    ]);
  });

  it("returns [] for no intervals", () => {
    expect(unionIntervals([])).toEqual([]);
  });
});
