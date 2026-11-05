import { describe, expect, it } from "vitest";
import {
  isStatus,
  isValidYmd,
  parseMilestoneInput,
  parsePeriodInput,
  parseSettingsInput,
  parseTaskInput,
} from "../validate";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const weeks = (id: string) => (id === "p" ? 10 : null);

const goodTask = { title: " Draft syllabus ", periodId: "p", week: "3", weekday: "2" };

describe("parseTaskInput", () => {
  it("trims and defaults optional fields", () => {
    expect(parseTaskInput(form(goodTask), weeks)).toEqual({
      ok: true,
      value: {
        title: "Draft syllabus", description: null, periodId: "p", week: 3,
        weekday: 2, milestoneId: null, assigneeIds: [], status: "Backlog",
      },
    });
  });

  it.each([
    [{ title: "  " }, "Add a title."],
    [{ title: "x".repeat(201) }, "Keep the title under 200 characters."],
    [{ description: "x".repeat(4001) }, "Keep the description under 4000 characters."],
    [{ periodId: "nope" }, "Pick a term or period."],
    [{ week: "0" }, "Pick a week from 1 to 10."],
    [{ week: "11" }, "Pick a week from 1 to 10."],
    [{ week: "abc" }, "Pick a week from 1 to 10."],
    [{ weekday: "7" }, "Pick a day of the week."],
    [{ weekday: "" }, "Pick a day of the week."],
    [{ status: "Blocked" }, "Pick a valid status."],
  ])("rejects %j", (patch, error) => {
    expect(parseTaskInput(form({ ...goodTask, ...patch }), weeks)).toEqual({ ok: false, error });
  });

  it("accepts every status and keeps ids", () => {
    for (const status of ["Backlog", "Todo", "Doing", "Done"]) {
      const r = parseTaskInput(form({ ...goodTask, status, milestoneId: "m1", assigneeIds: "u1,u1,u2" }), weeks);
      expect(r).toMatchObject({ ok: true, value: { status, milestoneId: "m1", assigneeIds: ["u1", "u2"] } });
    }
  });
});

describe("parseMilestoneInput", () => {
  const good = { name: "Launch", periodId: "p", startWeek: "2", endWeek: "5" };
  it("parses a valid span", () => {
    expect(parseMilestoneInput(form(good), weeks)).toEqual({
      ok: true,
      value: { name: "Launch", description: null, periodId: "p", startWeek: 2, endWeek: 5 },
    });
  });

  it.each([
    [{ name: "" }, "Add a name."],
    [{ name: "x".repeat(121) }, "Keep the name under 120 characters."],
    [{ periodId: "z" }, "Pick a term or period."],
    [{ startWeek: "6" }, "Pick a span within weeks 1 to 10."],
    [{ endWeek: "11" }, "Pick a span within weeks 1 to 10."],
    [{ startWeek: "0" }, "Pick a span within weeks 1 to 10."],
    [{ startWeek: "x" }, "Pick a span within weeks 1 to 10."],
  ])("rejects %j", (patch, error) => {
    expect(parseMilestoneInput(form({ ...good, ...patch }), weeks)).toEqual({ ok: false, error });
  });

  it("allows a single-week milestone", () => {
    expect(parseMilestoneInput(form({ ...good, startWeek: "4", endWeek: "4" }), weeks).ok).toBe(true);
  });
});

describe("parsePeriodInput", () => {
  const good = { name: "Interim", kind: "Interim", startDate: "2026-11-22", weekCount: "6" };
  it("parses and derives a short name", () => {
    expect(parsePeriodInput(form(good))).toEqual({
      ok: true,
      value: { name: "Interim", shortName: "Interim", kind: "Interim", startDate: "2026-11-22", weekCount: 6 },
    });
  });

  it("clamps the week count", () => {
    expect(parsePeriodInput(form({ ...good, weekCount: "40" }))).toMatchObject({ value: { weekCount: 14 } });
    expect(parsePeriodInput(form({ ...good, weekCount: "1" }))).toMatchObject({ value: { weekCount: 1 } });
    expect(parsePeriodInput(form({ ...good, kind: "Term", weekCount: "1" }))).toMatchObject({ value: { weekCount: 4 } });
  });

  it.each([
    [{ name: "" }, "Add a name."],
    [{ name: "x".repeat(61) }, "Keep the name under 60 characters."],
    [{ kind: "Break" }, "Pick a type."],
    [{ startDate: "2026-13-40" }, "Pick a start date."],
    [{ startDate: "2026-11-23" }, "Periods start on a Sunday."],
    [{ weekCount: "" }, "Enter the number of weeks."],
  ])("rejects %j", (patch, error) => {
    expect(parsePeriodInput(form({ ...good, ...patch }))).toEqual({ ok: false, error });
  });
});

describe("small guards", () => {
  it("validates statuses", () => {
    expect(isStatus("Doing")).toBe(true);
    expect(isStatus("doing")).toBe(false);
    expect(isStatus(3)).toBe(false);
  });

  it("validates real calendar dates only", () => {
    expect(isValidYmd("2026-02-29")).toBe(false);
    expect(isValidYmd("2028-02-29")).toBe(true);
    expect(isValidYmd("2026-2-1")).toBe(false);
  });
});

describe("parseSettingsInput", () => {
  it("clamps the default term length", () => {
    expect(parseSettingsInput(form({ termWeeks: "10" }))).toEqual({ ok: true, value: { termWeeks: 10 } });
    expect(parseSettingsInput(form({ termWeeks: "2" }))).toEqual({ ok: true, value: { termWeeks: 4 } });
    expect(parseSettingsInput(form({ termWeeks: "40" }))).toEqual({ ok: true, value: { termWeeks: 14 } });
  });

  it("rejects a missing or non-numeric value", () => {
    expect(parseSettingsInput(form({}))).toEqual({ ok: false, error: "Enter the number of weeks." });
    expect(parseSettingsInput(form({ termWeeks: "ten" }))).toMatchObject({ ok: false });
  });
});
