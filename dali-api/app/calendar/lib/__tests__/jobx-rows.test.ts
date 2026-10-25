import { describe, expect, it } from "vitest";
import { clockTime, offsetHireHandoffs, splitAtMidnight, type JobxRow } from "../jobx-rows";

const TZ = "America/New_York";

const split = (startIso: string, endIso: string, hours: number) =>
  splitAtMidnight(
    { hireKey: "a", start: new Date(startIso), end: new Date(endIso), hours, description: "Work" },
    TZ,
  ).map((r) => [r.date, clockTime(r.startMin), clockTime(r.endMin), r.hours]);

const row = (hireKey: string, start: string, end: string, date = "2026-09-01"): JobxRow => {
  const min = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
  return { hireKey, date, startMin: min(start), endMin: min(end), hours: 1, description: "" };
};
const times = (rows: JobxRow[]) => rows.map((r) => `${r.hireKey} ${clockTime(r.startMin)}-${clockTime(r.endMin)}`);

describe("clockTime", () => {
  it("formats minutes since midnight as HH:mm", () => {
    expect(clockTime(0)).toBe("00:00");
    expect(clockTime(14 * 60 + 5)).toBe("14:05");
    expect(clockTime(1439)).toBe("23:59");
  });
});

describe("splitAtMidnight", () => {
  it("keeps a same-day entry as one row", () => {
    expect(split("2026-09-01T18:00:00Z", "2026-09-01T20:00:00Z", 2)).toEqual([["2026-09-01", "14:00", "16:00", 2]]);
  });

  it("splits Monday 11pm to Tuesday 1am into one row per day", () => {
    expect(split("2026-09-01T03:00:00Z", "2026-09-01T05:00:00Z", 2)).toEqual([
      ["2026-08-31", "23:00", "23:59", 1],
      ["2026-09-01", "00:00", "01:00", 1],
    ]);
  });

  it("ends an entry that stops at midnight on 23:59 of its own day", () => {
    expect(split("2026-09-01T03:00:00Z", "2026-09-01T04:00:00Z", 1)).toEqual([["2026-08-31", "23:00", "23:59", 1]]);
  });

  it("gives each day of a multi-day entry its own row", () => {
    expect(split("2026-09-01T02:00:00Z", "2026-09-02T06:00:00Z", 28)).toEqual([
      ["2026-08-31", "22:00", "23:59", 2],
      ["2026-09-01", "00:00", "23:59", 24],
      ["2026-09-02", "00:00", "02:00", 2],
    ]);
  });

  it("shares the logged hours out by each day's part of the span", () => {
    expect(split("2026-09-01T03:00:00Z", "2026-09-01T06:00:00Z", 1.5).map((r) => r[3])).toEqual([0.5, 1]);
  });

  it("keeps the description and hire on every piece", () => {
    const rows = splitAtMidnight(
      { hireKey: "h1", start: new Date("2026-09-01T03:00:00Z"), end: new Date("2026-09-01T05:00:00Z"), hours: 2, description: "Deploy" },
      TZ,
    );
    expect(rows.map((r) => [r.hireKey, r.description])).toEqual([["h1", "Deploy"], ["h1", "Deploy"]]);
  });

  it("splits at local midnight on a DST change", () => {
    // Nov 1 2026, clocks fall back at 2am; 11pm Oct 31 to 1am Nov 1 is still two local days.
    expect(split("2026-11-01T03:00:00Z", "2026-11-01T05:00:00Z", 2).map((r) => r.slice(0, 3))).toEqual([
      ["2026-10-31", "23:00", "23:59"],
      ["2026-11-01", "00:00", "01:00"],
    ]);
  });

  it("returns one empty row for a zero-length entry rather than dropping it", () => {
    expect(split("2026-09-01T18:00:00Z", "2026-09-01T18:00:00Z", 0)).toEqual([["2026-09-01", "14:00", "14:00", 0]]);
  });
});

describe("offsetHireHandoffs", () => {
  it("moves the later of two back-to-back hires a minute later, keeping its length", () => {
    expect(times(offsetHireHandoffs([row("a", "13:00", "14:00"), row("b", "14:00", "15:00")]))).toEqual([
      "a 13:00-14:00",
      "b 14:01-15:01",
    ]);
  });

  it("gives the same result whatever order the rows come in", () => {
    expect(times(offsetHireHandoffs([row("b", "14:00", "15:00"), row("a", "13:00", "14:00")]))).toEqual([
      "b 14:01-15:01",
      "a 13:00-14:00",
    ]);
  });

  it("leaves back-to-back rows of one hire alone", () => {
    expect(times(offsetHireHandoffs([row("a", "13:00", "14:00"), row("a", "14:00", "15:00")]))).toEqual([
      "a 13:00-14:00",
      "a 14:00-15:00",
    ]);
  });

  it("only moves the start when the row's own hire picks up at its end", () => {
    expect(
      times(offsetHireHandoffs([row("a", "13:00", "14:00"), row("b", "14:00", "15:00"), row("b", "15:00", "16:00")])),
    ).toEqual(["a 13:00-14:00", "b 14:01-15:00", "b 15:00-16:00"]);
  });

  it("cascades through a chain of hires", () => {
    expect(
      times(offsetHireHandoffs([row("a", "13:00", "14:00"), row("b", "14:00", "15:00"), row("c", "15:00", "16:00")])),
    ).toEqual(["a 13:00-14:00", "b 14:01-15:00", "c 15:01-16:01"]);
  });

  it("follows a moved row into the next handoff", () => {
    expect(
      times(offsetHireHandoffs([row("a", "13:00", "14:00"), row("b", "14:00", "15:00"), row("a", "15:01", "16:00")])),
    ).toEqual(["a 13:00-14:00", "b 14:01-15:01", "a 15:02-16:01"]);
  });

  it("won't push a row past 23:59", () => {
    expect(times(offsetHireHandoffs([row("a", "22:00", "23:00"), row("b", "23:00", "23:59")]))).toEqual([
      "a 22:00-23:00",
      "b 23:01-23:59",
    ]);
  });

  it("only compares rows on the same day", () => {
    expect(
      times(offsetHireHandoffs([row("a", "13:00", "14:00", "2026-09-01"), row("b", "14:00", "15:00", "2026-09-02")])),
    ).toEqual(["a 13:00-14:00", "b 14:00-15:00"]);
  });

  it("leaves rows with a gap between them alone", () => {
    expect(times(offsetHireHandoffs([row("a", "13:00", "14:00"), row("b", "14:30", "15:00")]))).toEqual([
      "a 13:00-14:00",
      "b 14:30-15:00",
    ]);
  });

  it("doesn't change the rows it was given", () => {
    const input = [row("a", "13:00", "14:00"), row("b", "14:00", "15:00")];
    offsetHireHandoffs(input);
    expect(times(input)).toEqual(["a 13:00-14:00", "b 14:00-15:00"]);
  });
});
