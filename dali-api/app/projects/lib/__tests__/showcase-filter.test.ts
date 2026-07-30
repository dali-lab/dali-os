import { describe, it, expect } from "vitest";
import {
  matchesShowcaseFilter,
  SHOWCASE_FILTER_ALL,
  SHOWCASE_FILTER_NONE,
} from "~/projects/lib/showcase-filter";

describe("matchesShowcaseFilter", () => {
  it("passes everything through when unfiltered", () => {
    expect(matchesShowcaseFilter("Published", SHOWCASE_FILTER_ALL)).toBe(true);
    expect(matchesShowcaseFilter(null, SHOWCASE_FILTER_ALL)).toBe(true);
  });

  it("matches a status exactly", () => {
    expect(matchesShowcaseFilter("Published", "Published")).toBe(true);
    expect(matchesShowcaseFilter("NeedsReview", "Published")).toBe(false);
    expect(matchesShowcaseFilter("Archive", "Archive")).toBe(true);
  });

  it("separates 'not written up' from every real status", () => {
    // The distinction the filter exists for: a project with no showcase row is
    // not the same as one whose row sits at NotStarted.
    expect(matchesShowcaseFilter(null, SHOWCASE_FILTER_NONE)).toBe(true);
    expect(matchesShowcaseFilter("NotStarted", SHOWCASE_FILTER_NONE)).toBe(false);
    expect(matchesShowcaseFilter(null, "NotStarted")).toBe(false);
  });

  it("matches nothing for an unrecognised filter value", () => {
    // ?public=garbage must not read as "no projects are published".
    expect(matchesShowcaseFilter("Published", "garbage")).toBe(false);
    expect(matchesShowcaseFilter(null, "garbage")).toBe(false);
  });
});
