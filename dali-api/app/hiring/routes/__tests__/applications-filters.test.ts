import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, isApplicationFilters } from "~/hiring/lib/application-filters";

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
