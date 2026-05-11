import { describe, it, expect } from "vitest";
import {
  inReviewPipelineFilter,
  isWithdrawn,
  isInReviewPipeline,
} from "~/hiring/lib/application-pipeline-filter";

describe("inReviewPipelineFilter", () => {
  it("requires Submitted AND excludes Withdrawn — withdrawals are terminal", () => {
    // Shape is the contract used by every review-pipeline query. If this
    // changes, the four+ callsites that spread it into a `where` need a sweep.
    expect(inReviewPipelineFilter).toEqual({
      statusUpdates: { some: { newStatus: "Submitted" } },
      NOT: { statusUpdates: { some: { newStatus: "Withdrawn" } } },
    });
  });
});

describe("isWithdrawn", () => {
  it("returns true when any update is Withdrawn", () => {
    expect(
      isWithdrawn([{ newStatus: "Submitted" }, { newStatus: "Withdrawn" }]),
    ).toBe(true);
  });

  it("returns false when no Withdrawn update exists", () => {
    expect(isWithdrawn([{ newStatus: "Submitted" }])).toBe(false);
  });

  it("returns false on empty history", () => {
    expect(isWithdrawn([])).toBe(false);
  });
});

describe("isInReviewPipeline", () => {
  it("true when Submitted and not Withdrawn", () => {
    expect(isInReviewPipeline([{ newStatus: "Submitted" }])).toBe(true);
  });

  it("false when Withdrawn after Submitted", () => {
    expect(
      isInReviewPipeline([
        { newStatus: "Submitted" },
        { newStatus: "Withdrawn" },
      ]),
    ).toBe(false);
  });

  it("false when never submitted", () => {
    expect(isInReviewPipeline([])).toBe(false);
  });
});
