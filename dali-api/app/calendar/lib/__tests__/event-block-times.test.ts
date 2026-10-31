import { describe, it, expect } from "vitest";
import { localDayTimeToIso, nominalDayRange } from "~/calendar/lib/event-block";

const NY = "America/New_York";

describe("localDayTimeToIso", () => {
  it("reads a typed time on the wall clock on an ordinary day", () => {
    expect(localDayTimeToIso("2026-10-27", "11:00", NY)).toBe("2026-10-27T15:00:00.000Z");
  });

  it("reads a typed time on the wall clock on the day clocks fall back", () => {
    expect(localDayTimeToIso("2026-11-01", "11:00", NY)).toBe("2026-11-01T16:00:00.000Z");
  });

  it("reads a typed time on the wall clock on the day clocks spring forward", () => {
    expect(localDayTimeToIso("2027-03-14", "11:00", NY)).toBe("2027-03-14T15:00:00.000Z");
  });

  it("rejects a malformed date or time", () => {
    expect(localDayTimeToIso("", "11:00", NY)).toBeNull();
    expect(localDayTimeToIso("2026-11-01", "soon", NY)).toBeNull();
  });
});

describe("nominalDayRange", () => {
  it("starts at 9:00 on the day clocks fall back", () => {
    expect(nominalDayRange("2026-11-01T00:00:00Z", 2, NY)).toEqual({
      startIso: "2026-11-01T14:00:00.000Z",
      endIso: "2026-11-01T16:00:00.000Z",
    });
  });

  it("gives a zero-hour entry a visible block and honors a fractional start", () => {
    expect(nominalDayRange("2026-10-27", 0, NY, 13.5)).toEqual({
      startIso: "2026-10-27T17:30:00.000Z",
      endIso: "2026-10-27T17:45:00.000Z",
    });
  });
});
