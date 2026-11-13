import { describe, expect, it } from "vitest";
import { createMilestoneLabel, milestoneLabel, noMatchLabel, searchHeader, searchMilestones } from "../milestone-search";
import type { BoardPeriod } from "../weeks";

const periods: BoardPeriod[] = [
  { id: "f", name: "Fall", shortName: "26F", kind: "Term", startDate: "2026-09-13", weekCount: 10 },
  { id: "w", name: "Winter", shortName: "27W", kind: "Term", startDate: "2027-01-03", weekCount: 10 },
  { id: "s", name: "Spring", shortName: "27S", kind: "Term", startDate: "2027-03-28", weekCount: 10 },
];
const ms = [
  { id: "1", periodId: "w", name: "Check-ins", startWeek: 2, endWeek: 4 },
  { id: "2", periodId: "f", name: "Mini-series check-ins", startWeek: 3, endWeek: 8 },
  { id: "3", periodId: "f", name: "Onboarding", startWeek: 1, endWeek: 2 },
  { id: "4", periodId: "s", name: "Check-ins", startWeek: 1, endWeek: 2 },
];

describe("searchMilestones", () => {
  it("with no query lists the due period's milestones by start week", () => {
    const r = searchMilestones(ms, periods, "f", "");
    expect(r.mode).toBe("in-period");
    expect(r.items.map((m) => m.id)).toEqual(["3", "2"]);
  });

  it("treats a whitespace query as empty", () => {
    expect(searchMilestones(ms, periods, "f", "   ").mode).toBe("in-period");
  });

  it("searches every term, case insensitively, due period first then chronologically", () => {
    const r = searchMilestones(ms, periods, "w", "CHECK");
    expect(r.mode).toBe("across");
    expect(r.items.map((m) => m.id)).toEqual(["1", "2", "4"]);
  });

  it("returns nothing when no name matches", () => {
    expect(searchMilestones(ms, periods, "f", "zzz").items).toEqual([]);
  });
});

describe("labels", () => {
  it("shows a term short name only for milestones in another term", () => {
    expect(milestoneLabel(ms[1], periods, "f")).toBe("Mini-series check-ins · Wk 3 to 8");
    expect(milestoneLabel(ms[0], periods, "f")).toBe("Check-ins · 27W · Wk 2 to 4");
  });

  it("words the header by mode", () => {
    expect(searchHeader("in-period", "26F")).toBe("In 26F · type to search other terms");
    expect(searchHeader("across", "26F")).toBe("Matches across all terms");
  });

  it("words the create row and the empty state", () => {
    expect(createMilestoneLabel("")).toBe("+ Create a new milestone");
    expect(createMilestoneLabel("  Survey ")).toBe('+ Create milestone "Survey"');
    expect(noMatchLabel(" x ")).toBe('No milestone matches "x".');
  });
});
