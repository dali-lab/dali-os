import { describe, expect, it } from "vitest";
import {
  applicationColumns,
  visibleSort,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  isApplicationFilters,
  isApplicationSort,
  sortApplications,
  withFilterDefaults,
} from "~/hiring/lib/application-filters";

describe("isApplicationFilters", () => {
  it("accepts the empty shape and a populated one", () => {
    expect(isApplicationFilters(EMPTY_FILTERS)).toBe(true);
    expect(
      isApplicationFilters({
        domainIds: ["d1"],
        statuses: ["Submitted"],
        stage: "Interview",
        engagement: ["returning", "educated", "attendedEvent"],
        eventIds: ["ev1"],
        pieIncludesInProgress: true,
        query: "ada",
      }),
    ).toBe(true);
  });

  it("accepts filters stored before eventIds existed and fills the default in", () => {
    const { eventIds: _omit, ...stale } = EMPTY_FILTERS;
    expect(isApplicationFilters(stale)).toBe(true);
    expect(withFilterDefaults(stale as typeof EMPTY_FILTERS).eventIds).toEqual([]);
    expect(isApplicationFilters({ ...EMPTY_FILTERS, eventIds: [1] })).toBe(false);
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
    expect(isApplicationSort({ key: "reviewers", dir: "desc" })).toBe(true);
    expect(isApplicationSort({ key: "interviewers", dir: "asc" })).toBe(true);
    expect(isApplicationSort({ key: "reviewCount", dir: "desc" })).toBe(false);
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
    reviewers: null as string | null,
    interviewers: null as string | null,
    ...over,
  });
  const names = (rows: { name: string }[]) => rows.map((r) => r.name);

  it("sorts text columns in both directions without mutating the input", () => {
    const rows = [row("Bo"), row("Ada"), row("Cy")];
    expect(names(sortApplications(rows, { key: "name", dir: "asc" }))).toEqual(["Ada", "Bo", "Cy"]);
    expect(names(sortApplications(rows, { key: "name", dir: "desc" }))).toEqual(["Cy", "Bo", "Ada"]);
    expect(names(rows)).toEqual(["Bo", "Ada", "Cy"]);
  });

  it("sorts reviewer and interviewer names, with unassigned rows last", () => {
    const rows = [row("Ada", { reviewers: "Zed Q" }), row("Bo"), row("Cy", { reviewers: "Amy R" })];
    expect(names(sortApplications(rows, { key: "reviewers", dir: "asc" }))).toEqual(["Cy", "Ada", "Bo"]);
    expect(names(sortApplications(rows, { key: "reviewers", dir: "desc" }))).toEqual(["Ada", "Cy", "Bo"]);
    const iv = [row("Ada"), row("Bo", { interviewers: "Kim L" })];
    expect(names(sortApplications(iv, { key: "interviewers", dir: "asc" }))).toEqual(["Bo", "Ada"]);
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

describe("applicationColumns", () => {
  const keys = (status: string) => applicationColumns(status).map((c) => c.key);

  it("shows reviewers and interviewers instead of the submitted date while under review", () => {
    expect(keys("UnderReview")).toEqual(["name", "domain", "status", "reviewers", "interviewers"]);
  });

  it("shows the submitted date and no assignee columns in every other stage", () => {
    for (const status of ["Draft", "Open", "Completed", ""]) {
      expect(keys(status)).toEqual(["name", "domain", "status", "submittedAt"]);
    }
  });
});

describe("visibleSort", () => {
  it("keeps a sort on a column that is shown", () => {
    const sort = { key: "reviewers", dir: "desc" } as const;
    expect(visibleSort(sort, applicationColumns("UnderReview"))).toEqual(sort);
  });

  it("falls back to the default when the sorted column is hidden for this cycle", () => {
    expect(visibleSort({ key: "reviewers", dir: "desc" }, applicationColumns("Open"))).toEqual(DEFAULT_SORT);
    expect(visibleSort({ key: "submittedAt", dir: "asc" }, applicationColumns("UnderReview"))).toEqual(DEFAULT_SORT);
  });
});
