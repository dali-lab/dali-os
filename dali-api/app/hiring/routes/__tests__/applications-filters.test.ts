import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, isApplicationFilters } from "../applications";

describe("isApplicationFilters", () => {
  it("accepts the empty shape and a populated one", () => {
    expect(isApplicationFilters(EMPTY_FILTERS)).toBe(true);
    expect(
      isApplicationFilters({
        domainIds: ["d1"],
        statuses: ["Submitted"],
        stage: "Interview",
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
  });
});
