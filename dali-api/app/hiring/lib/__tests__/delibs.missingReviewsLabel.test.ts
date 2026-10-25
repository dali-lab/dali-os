import { describe, it, expect } from "vitest";
import { missingReviewsLabel } from "~/hiring/lib/delibs";

describe("missingReviewsLabel", () => {
  it("is null once every assigned review is submitted", () => {
    expect(missingReviewsLabel(3, 3)).toBeNull();
    expect(missingReviewsLabel(1, 1)).toBeNull();
  });

  it("counts the missing reviews out of those assigned", () => {
    expect(missingReviewsLabel(1, 3)).toBe("2 of 3 reviews missing");
    expect(missingReviewsLabel(0, 2)).toBe("2 of 2 reviews missing");
  });

  it("uses the singular for a single assigned review", () => {
    expect(missingReviewsLabel(0, 1)).toBe("1 of 1 review missing");
  });

  it("flags an applicant with no reviewers at all", () => {
    expect(missingReviewsLabel(0, 0)).toBe("No reviewers assigned");
  });
});
