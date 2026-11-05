import { describe, expect, it } from "vitest";
import {
  addDays,
  clampPeriodWeeks,
  clampWeekCount,
  currentPosition,
  locateWeek,
  periodEnd,
  relationToCurrent,
  sundayOnOrBefore,
  taskDate,
  termPeriodFromDates,
  weekEnd,
  weekStart,
  ymdFromDate,
  type BoardPeriod,
} from "../weeks";

const fall: BoardPeriod = {
  id: "f", name: "Fall 2026", shortName: "26F", kind: "Term",
  startDate: "2026-09-13", weekCount: 10,
};
const interim: BoardPeriod = {
  id: "i", name: "Interim", shortName: "Int", kind: "Interim",
  startDate: "2026-11-22", weekCount: 6,
};
const winter: BoardPeriod = {
  id: "w", name: "Winter 2027", shortName: "27W", kind: "Term",
  startDate: "2027-01-03", weekCount: 10,
};
const all = [fall, interim, winter];

describe("week math", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the Sunday on or before a date", () => {
    expect(sundayOnOrBefore("2026-09-13")).toBe("2026-09-13");
    expect(sundayOnOrBefore("2026-09-19")).toBe("2026-09-13");
    expect(sundayOnOrBefore("2026-09-14")).toBe("2026-09-13");
  });

  it("derives week boundaries, period end and task dates", () => {
    expect(weekStart(fall, 1)).toBe("2026-09-13");
    expect(weekStart(fall, 8)).toBe("2026-11-01");
    expect(weekEnd(fall, 10)).toBe("2026-11-21");
    expect(periodEnd(fall)).toBe("2026-11-21");
    expect(taskDate(fall, 8, 3)).toBe("2026-11-04");
  });

  it("clamps term length to 4 to 14 weeks", () => {
    expect(clampWeekCount(1)).toBe(4);
    expect(clampWeekCount(99)).toBe(14);
    expect(clampWeekCount(10.4)).toBe(10);
    expect(clampWeekCount(Number.NaN)).toBe(4);
  });

  it("formats a date in the given zone, not UTC", () => {
    const lateSaturdayNy = new Date("2026-11-08T03:30:00Z");
    expect(ymdFromDate(lateSaturdayNy, "America/New_York")).toBe("2026-11-07");
    expect(ymdFromDate(lateSaturdayNy, "UTC")).toBe("2026-11-08");
  });

  it("keeps wall dates stable across the daylight saving change", () => {
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(locateWeek(all, "2026-11-01")).toEqual({ periodId: "f", week: 8 });
    expect(locateWeek(all, "2026-11-07")).toEqual({ periodId: "f", week: 8 });
    expect(locateWeek(all, "2026-11-08")).toEqual({ periodId: "f", week: 9 });
  });
});

describe("locateWeek", () => {
  it("places dates in terms and interims", () => {
    expect(locateWeek(all, "2026-09-13")).toEqual({ periodId: "f", week: 1 });
    expect(locateWeek(all, "2026-11-21")).toEqual({ periodId: "f", week: 10 });
    expect(locateWeek(all, "2026-11-22")).toEqual({ periodId: "i", week: 1 });
    expect(locateWeek(all, "2027-01-02")).toEqual({ periodId: "i", week: 6 });
    expect(locateWeek(all, "2027-01-03")).toEqual({ periodId: "w", week: 1 });
  });

  it("returns null outside every period", () => {
    expect(locateWeek(all, "2026-09-12")).toBeNull();
    expect(locateWeek(all, "2027-03-14")).toBeNull();
  });
});

describe("currentPosition", () => {
  it("is null with no periods", () => {
    expect(currentPosition([], "2026-11-04")).toBeNull();
  });

  it("returns the real week when inside a period", () => {
    expect(currentPosition(all, "2026-11-04")).toEqual({
      periodId: "f", week: 8, between: false,
    });
  });

  it("falls forward to the next period when between periods", () => {
    const gap = [fall, winter];
    expect(currentPosition(gap, "2026-12-01")).toEqual({
      periodId: "w", week: 1, between: true,
    });
  });

  it("falls back to the last week after every period", () => {
    expect(currentPosition(all, "2030-01-01")).toEqual({
      periodId: "w", week: 10, between: true,
    });
  });

  it("is order independent", () => {
    expect(currentPosition([winter, fall, interim], "2026-11-04")?.periodId).toBe("f");
  });
});

describe("relationToCurrent", () => {
  const current = { periodId: "f", week: 8 };
  it("labels past, current, next and future weeks", () => {
    expect(relationToCurrent(all, { periodId: "f", week: 7 }, current)).toBe("past");
    expect(relationToCurrent(all, { periodId: "f", week: 8 }, current)).toBe("current");
    expect(relationToCurrent(all, { periodId: "f", week: 9 }, current)).toBe("next");
    expect(relationToCurrent(all, { periodId: "f", week: 10 }, current)).toBe("future");
    expect(relationToCurrent(all, { periodId: "w", week: 1 }, current)).toBe("future");
  });

  it("treats an unknown period as future", () => {
    expect(relationToCurrent(all, { periodId: "x", week: 1 }, current)).toBe("future");
  });
});

describe("termPeriodFromDates", () => {
  it("aligns to Sunday and counts weeks inclusive", () => {
    expect(
      termPeriodFromDates({
        start: new Date("2026-09-14T00:00:00Z"),
        end: new Date("2026-11-21T00:00:00Z"),
      }),
    ).toEqual({ startDate: "2026-09-13", weekCount: 10 });
  });

  it("clamps absurd lengths", () => {
    expect(
      termPeriodFromDates({
        start: new Date("2026-01-01T00:00:00Z"),
        end: new Date("2026-01-02T00:00:00Z"),
      }).weekCount,
    ).toBe(4);
  });
});

describe("clampPeriodWeeks", () => {
  it("keeps terms between 4 and 14 weeks", () => {
    expect(clampPeriodWeeks("Term", 2)).toBe(4);
    expect(clampPeriodWeeks("Term", 20)).toBe(14);
  });

  it("lets interims and custom periods be as short as one week", () => {
    expect(clampPeriodWeeks("Interim", 2)).toBe(2);
    expect(clampPeriodWeeks("Custom", 1)).toBe(1);
    expect(clampPeriodWeeks("Interim", 0)).toBe(1);
    expect(clampPeriodWeeks("Custom", 99)).toBe(14);
    expect(clampPeriodWeeks("Interim", Number.NaN)).toBe(1);
  });
});
