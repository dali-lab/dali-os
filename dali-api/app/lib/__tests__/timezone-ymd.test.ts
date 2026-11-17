import { describe, it, expect } from "vitest";
import { ymdDayStartUtc } from "../timezone";

describe("ymdDayStartUtc", () => {
  it.each([
    ["2026-10-14", "America/New_York", "2026-10-14T04:00:00.000Z"],
    ["2026-01-14", "America/New_York", "2026-01-14T05:00:00.000Z"],
    ["2026-03-08", "America/New_York", "2026-03-08T05:00:00.000Z"],
    ["2026-03-09", "America/New_York", "2026-03-09T04:00:00.000Z"],
    ["2028-02-29", "America/New_York", "2028-02-29T05:00:00.000Z"],
    ["2026-10-14", "UTC", "2026-10-14T00:00:00.000Z"],
  ])("reads %s as midnight in %s", (ymd, tz, iso) => {
    expect(ymdDayStartUtc(ymd, tz)?.toISOString()).toBe(iso);
  });

  it.each([
    "2026-02-30",
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "0099-01-01",
    "2026-1-5",
    "2026-10-14T00:00",
    "tuesday",
    "",
  ])("returns null for %j", (ymd) => {
    expect(ymdDayStartUtc(ymd, "America/New_York")).toBeNull();
  });
});
