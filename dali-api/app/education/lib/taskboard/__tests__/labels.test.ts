import { describe, expect, it } from "vitest";
import { dateRange, firstName, relationLabel, rolloverBanner, shortDate, taskMeta, weeksLabel } from "../labels";

describe("labels", () => {
  it("formats short dates without leading zeros", () => {
    expect(shortDate("2026-11-01")).toBe("Nov 1");
    expect(shortDate("2027-01-03")).toBe("Jan 3");
  });

  it("joins ranges with the word to", () => {
    expect(dateRange("2026-09-13", "2026-11-21")).toBe("Sep 13 to Nov 21");
  });

  it("pluralises weeks", () => {
    expect(weeksLabel(1)).toBe("1 week");
    expect(weeksLabel(10)).toBe("10 weeks");
  });

  it("describes a week relative to now", () => {
    expect(relationLabel("current", 0)).toBe("This week");
    expect(relationLabel("past", 0)).toBe("Past");
    expect(relationLabel("next", 1)).toBe("Next week");
    expect(relationLabel("future", 3)).toBe("In 3 weeks");
  });

  it("builds the rollover banner only when something rolled", () => {
    expect(rolloverBanner(0, 7)).toBeNull();
    expect(rolloverBanner(1, 7)).toBe("1 task rolled over from Week 7. Anything not done by Saturday moves to next week.");
    expect(rolloverBanner(4, null)).toBe("4 tasks rolled over from earlier weeks. Anything not done by Saturday moves to next week.");
  });

  it("describes a task's owner, week and day", () => {
    expect(taskMeta({ assignees: ["Joyce Zou", "Arthur Ng"], week: 8, weekday: 4, periodShort: null })).toBe("Joyce, Arthur · Wk 8 Thu");
    expect(taskMeta({ assignees: [], week: 2, weekday: 0, periodShort: "27W" })).toBe("Unassigned · 27W Wk 2 Sun");
  });

  it("uses no em dashes", () => {
    expect(rolloverBanner(2, 3)).not.toContain("—");
  });

  it("takes the first word of a name", () => {
    expect(firstName("  Ada  Lovelace ")).toBe("Ada");
    expect(firstName("")).toBe("");
  });
});
