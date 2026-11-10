import { describe, expect, it } from "vitest";
import { termWeekNumber } from "~/lib/terms.shared";
import {
  currentTermWeek,
  isValidWeek,
  nextTermLabel,
  renumber,
  reorder,
  sameSeasonLastYear,
  termLabel,
  weekRange,
  weekStartMs,
  weekSummary,
  type MilestoneItem,
} from "~/core/lib/milestones";

const DAY = 86_400_000;
const start = Date.UTC(2026, 8, 21);

describe("week dates", () => {
  it("makes week 0 the 7 days before the term starts", () => {
    expect(weekStartMs(start, 0)).toBe(start - 7 * DAY);
    expect(weekRange(start, 0)).toEqual({ startMs: start - 7 * DAY, endMs: start - DAY });
  });

  it("matches termWeekNumber for weeks 1 to 10", () => {
    for (let w = 1; w <= 10; w++) {
      const { startMs, endMs } = weekRange(start, w);
      expect(termWeekNumber(startMs, start)).toBe(w);
      expect(termWeekNumber(endMs, start)).toBe(w);
    }
  });

  it("finds the current week, including the lead-up, and none outside the plan", () => {
    expect(currentTermWeek(start - 3 * DAY, start)).toBe(0);
    expect(currentTermWeek(start + 8 * DAY, start)).toBe(2);
    expect(currentTermWeek(start - 8 * DAY, start)).toBeNull();
    expect(currentTermWeek(start + 80 * DAY, start)).toBeNull();
  });

  it("accepts only weeks 0 to 10", () => {
    expect([0, 10].every(isValidWeek)).toBe(true);
    expect([-1, 11, 1.5, "3", NaN].some(isValidWeek)).toBe(false);
  });
});

describe("sameSeasonLastYear", () => {
  const terms = [
    { id: "a", year: 2025, season: "F" },
    { id: "b", year: 2025, season: "X" },
    { id: "c", year: 2025, season: "W" },
  ];

  it("picks the same season one year back", () => {
    expect(sameSeasonLastYear({ id: "n", year: 2026, season: "F" }, terms)?.id).toBe("a");
  });

  it("uses the previous summer for a summer term", () => {
    expect(sameSeasonLastYear({ id: "n", year: 2026, season: "X" }, terms)?.id).toBe("b");
  });

  it("returns null when last year's term doesn't exist", () => {
    expect(sameSeasonLastYear({ id: "n", year: 2026, season: "S" }, terms)).toBeNull();
  });
});

describe("ordering helpers", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("renumbers from zero", () => {
    expect(renumber(list)).toEqual([
      { id: "a", position: 0 },
      { id: "b", position: 1 },
      { id: "c", position: 2 },
    ]);
  });

  it("moves an item to an index and clamps", () => {
    expect(reorder(list, "c", 0).map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(reorder(list, "a", 99).map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect(reorder(list, "zzz", 0)).toBe(list);
  });
});

describe("labels and summaries", () => {
  it("labels terms and the next one", () => {
    expect(termLabel({ season: "F", year: 2026 })).toBe("Fall 26");
    expect(nextTermLabel({ season: "F", year: 2026 })).toBe("Winter 27");
    expect(nextTermLabel({ season: "W", year: 2027 })).toBe("Spring 27");
  });

  it("summarises a week with a +N more count and a planned count", () => {
    const mk = (id: string, kind: "Milestone" | "Plan"): MilestoneItem => ({
      id,
      week: 2,
      kind,
      title: id,
      notes: null,
      position: 0,
      owners: [],
    });
    const items = [mk("a", "Milestone"), mk("b", "Milestone"), mk("c", "Milestone"), mk("p", "Plan")];
    expect(weekSummary(items, 2)).toEqual({ titles: ["a", "b"], more: 1, planned: 1 });
  });
});
