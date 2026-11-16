import { describe, expect, it } from "vitest";
import { addDaysToDate, isoToDateInput, isoToZonedFields } from "../composer-fields";

describe("isoToZonedFields", () => {
  it("reads wall-clock fields in the given zone", () => {
    expect(isoToZonedFields("2026-07-01T16:30:00Z", "America/New_York")).toEqual({
      date: "2026-07-01",
      time: "12:30",
    });
  });

  it("follows the UTC offset across the spring-forward boundary", () => {
    expect(isoToZonedFields("2026-03-08T06:30:00Z", "America/New_York")).toEqual({
      date: "2026-03-08",
      time: "01:30",
    });
    expect(isoToZonedFields("2026-03-08T07:30:00Z", "America/New_York")).toEqual({
      date: "2026-03-08",
      time: "03:30",
    });
  });

  it("follows the fall-back boundary", () => {
    expect(isoToZonedFields("2026-11-01T05:30:00Z", "America/New_York").time).toBe("01:30");
    expect(isoToZonedFields("2026-11-01T07:30:00Z", "America/New_York").time).toBe("02:30");
  });

  it("renders midnight as 00:00", () => {
    expect(isoToZonedFields("2026-01-15T05:00:00Z", "America/New_York")).toEqual({
      date: "2026-01-15",
      time: "00:00",
    });
  });
});

describe("addDaysToDate", () => {
  it("rolls over month and year ends", () => {
    expect(addDaysToDate("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles leap days and negative offsets", () => {
    expect(addDaysToDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("isoToDateInput", () => {
  it("takes the UTC date of an all-day instant", () => {
    expect(isoToDateInput("2026-05-04T00:00:00.000Z")).toBe("2026-05-04");
  });
});
