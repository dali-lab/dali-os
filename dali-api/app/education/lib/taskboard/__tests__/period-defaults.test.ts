import { describe, expect, it } from "vitest";
import { endFromLength, lengthFromEnd, periodSummary, suggestPeriodName, suggestShortName, termShortName } from "../period-defaults";

describe("termShortName", () => {
  it("uses the year and season letter of the start date", () => {
    expect(termShortName("2026-09-13")).toBe("26F");
    expect(termShortName("2027-01-10")).toBe("27W");
    expect(termShortName("2027-03-28")).toBe("27S");
    expect(termShortName("2027-06-20")).toBe("27X");
  });

  it("counts a December start as the next year's winter", () => {
    expect(termShortName("2026-12-27")).toBe("27W");
  });
});

describe("suggestPeriodName", () => {
  it("names terms by season and short code", () => {
    expect(suggestPeriodName("Term", "2027-06-20")).toBe("Summer 27X");
    expect(suggestPeriodName("Term", "2026-09-13")).toBe("Fall 26F");
  });

  it("names interims by season", () => {
    expect(suggestPeriodName("Interim", "2027-06-06")).toBe("Summer interim");
    expect(suggestPeriodName("Interim", "2027-01-03")).toBe("Winter interim");
  });

  it("gives custom periods a neutral name and handles a missing date", () => {
    expect(suggestPeriodName("Custom", "2027-06-06")).toBe("New period");
    expect(suggestPeriodName("Term", "")).toBe("New term");
    expect(suggestPeriodName("Interim", "")).toBe("Interim");
    expect(suggestPeriodName("Custom", "")).toBe("New period");
  });
});

describe("suggestShortName", () => {
  it("derives it from the kind", () => {
    expect(suggestShortName("Term", "Summer 27X", "2027-06-20")).toBe("27X");
    expect(suggestShortName("Interim", "Winter interim", "2027-01-03")).toBe("Int");
    expect(suggestShortName("Custom", "Orientation prep week", "2027-08-29")).toBe("Orientat");
  });

  it("falls back to the name for a term without a date", () => {
    expect(suggestShortName("Term", " New term ", "")).toBe("New term");
  });
});

describe("length and end date", () => {
  it("counts weeks inclusive and rounds up", () => {
    expect(lengthFromEnd("2026-11-22", "2027-01-02")).toBe(6);
    expect(lengthFromEnd("2026-11-22", "2026-11-23")).toBe(1);
    expect(lengthFromEnd("2026-11-22", "2026-11-29")).toBe(2);
  });

  it("clamps to 1 to 14 weeks and survives an end before the start", () => {
    expect(lengthFromEnd("2026-01-04", "2026-01-03")).toBe(1);
    expect(lengthFromEnd("2026-01-04", "2027-01-03")).toBe(14);
    expect(lengthFromEnd("2026-01-04", "nope")).toBe(1);
  });

  it("derives the last day from a length", () => {
    expect(endFromLength("2026-11-22", 6)).toBe("2027-01-02");
    expect(endFromLength("2026-09-13", 10)).toBe("2026-11-21");
  });
});

describe("periodSummary", () => {
  it("explains terms and flexible periods", () => {
    expect(periodSummary("Term", 10, true)).toBe("10 weeks from your term setting, numbered Week 1 to 10.");
    expect(periodSummary("Term", 8, false)).toBe("8 weeks numbered Week 1 to 8.");
    expect(periodSummary("Interim", 2, true)).toBe("2 weeks. Pick any end date for interims and custom ranges.");
    expect(periodSummary("Custom", 1, false)).toBe("1 week. Pick any end date for interims and custom ranges.");
  });
});
