import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  isApplicationFilters,
  isApplicationSort,
  sortApplications,
} from "~/hiring/lib/application-filters";

describe("isApplicationFilters", () => {
  it("accepts the empty shape and a populated one", () => {
    expect(isApplicationFilters(EMPTY_FILTERS)).toBe(true);
    expect(
      isApplicationFilters({
        domainIds: ["d1"],
        statuses: ["Submitted"],
        stage: "Interview",
        engagement: ["returning", "educated"],
        pieIncludesInProgress: true,
        query: "ada",
      }),
    ).toBe(true);
  });

  it("rejects stale or corrupt stored values", () => {
    expect(isApplicationFilters(null)).toBe(false);
    expect(isApplicationFilters({ domainIds: "d1" })).toBe(false);
    expect(isApplicationFilters({ ...EMPTY_FILTERS, stage: 3 })).toBe(false);
    expect(isApplicationFilters({ ...EMPTY_FILTERS, domainIds: [1] })).toBe(false);
    expect(isApplicationFilters({ ...EMPTY_FILTERS, engagement: ["classYear"] })).toBe(false);
  });
});

describe("isApplicationSort", () => {
  it("accepts known columns and rejects anything else", () => {
    expect(isApplicationSort(DEFAULT_SORT)).toBe(true);
    expect(isApplicationSort({ key: "reviewCount", dir: "desc" })).toBe(true);
    expect(isApplicationSort(null)).toBe(false);
    expect(isApplicationSort({ key: "email", dir: "asc" })).toBe(false);
    expect(isApplicationSort({ key: "name", dir: "up" })).toBe(false);
  });
});

describe("sortApplications", () => {
  const row = (name: string, over: Partial<Parameters<typeof sortApplications>[0][number]> = {}) => ({
    name,
    domain: "Dev",
    status: "Submitted",
    submittedAt: null as string | null,
    reviewCount: 0,
    ...over,
  });
  const names = (rows: { name: string }[]) => rows.map((r) => r.name);

  it("sorts text columns in both directions without mutating the input", () => {
    const rows = [row("Bo"), row("Ada"), row("Cy")];
    expect(names(sortApplications(rows, { key: "name", dir: "asc" }))).toEqual(["Ada", "Bo", "Cy"]);
    expect(names(sortApplications(rows, { key: "name", dir: "desc" }))).toEqual(["Cy", "Bo", "Ada"]);
    expect(names(rows)).toEqual(["Bo", "Ada", "Cy"]);
  });

  it("sorts review counts numerically", () => {
    const rows = [row("Ada", { reviewCount: 10 }), row("Bo", { reviewCount: 2 })];
    expect(names(sortApplications(rows, { key: "reviewCount", dir: "asc" }))).toEqual(["Bo", "Ada"]);
    expect(names(sortApplications(rows, { key: "reviewCount", dir: "desc" }))).toEqual(["Ada", "Bo"]);
  });

  it("keeps unsubmitted rows last in both directions", () => {
    const rows = [
      row("Ada"),
      row("Bo", { submittedAt: "2026-02-01T00:00:00.000Z" }),
      row("Cy", { submittedAt: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(names(sortApplications(rows, { key: "submittedAt", dir: "asc" }))).toEqual(["Cy", "Bo", "Ada"]);
    expect(names(sortApplications(rows, { key: "submittedAt", dir: "desc" }))).toEqual(["Bo", "Cy", "Ada"]);
  });

  it("keeps the incoming order for ties", () => {
    const rows = [row("Ada", { domain: "Design" }), row("Bo"), row("Cy", { domain: "Design" })];
    expect(names(sortApplications(rows, { key: "domain", dir: "desc" }))).toEqual(["Bo", "Ada", "Cy"]);
  });
});
