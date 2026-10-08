import { describe, expect, it } from "vitest";
import { formatMonthRange, parseWorkExperience } from "../work-experience";

const form = (fields: Record<string, string>) => (name: string) => fields[name] ?? "";
const base = { company: "Figma", position: "Designer", startMonth: "2024-08" };

describe("parseWorkExperience", () => {
  it("reads a current job: no end month, dates on the first of the month in UTC", () => {
    const r = parseWorkExperience(form({ ...base, workMode: "Hybrid", location: " New York " }));
    expect(r).toEqual({
      ok: true,
      value: {
        company: "Figma",
        position: "Designer",
        description: null,
        location: "New York",
        workMode: "Hybrid",
        startDate: new Date("2024-08-01T00:00:00.000Z"),
        endDate: null,
      },
    });
  });

  it("rejects a missing company, a missing start, and an end before the start", () => {
    expect(parseWorkExperience(form({ ...base, company: " " })).ok).toBe(false);
    expect(parseWorkExperience(form({ ...base, startMonth: "" })).ok).toBe(false);
    expect(parseWorkExperience(form({ ...base, endMonth: "2024-07" })).ok).toBe(false);
    expect(parseWorkExperience(form({ ...base, endMonth: "2024-08" })).ok).toBe(true);
  });

  it("rejects a work mode that isn't one of the three", () => {
    expect(parseWorkExperience(form({ ...base, workMode: "Sometimes" })).ok).toBe(false);
  });
});

describe("formatMonthRange", () => {
  it("names the months and calls an open end the present", () => {
    expect(formatMonthRange("2023-06", "2023-08")).toBe("Jun 2023 to Aug 2023");
    expect(formatMonthRange("2024-08", null)).toBe("Aug 2024 to present");
  });
});
