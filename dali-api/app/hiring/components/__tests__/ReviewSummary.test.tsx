import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewSummary } from "../ReviewSummary";

describe("ReviewSummary", () => {
  it("renders name, recommendation, labelled scores, feedback, and rejection rationale", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewSummary, {
        reviewerName: "Ada Lovelace",
        overallRecommendation: "Strong Hire",
        scores: { "crit-1": 4, "crit-2": 3 },
        criteria: {
          "crit-1": { label: "Technical", maxScore: 5 },
          "crit-2": { label: "Communication" },
        },
        feedback: "Great systems thinking.",
        rejectionRationale: "N/A",
      }),
    );

    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Strong Hire");
    expect(html).toContain("Technical");
    // maxScore present -> "n/max"; absent -> bare value.
    expect(html).toContain("4/5");
    expect(html).toContain("Communication");
    expect(html).toContain("Great systems thinking.");
    expect(html).toContain("N/A");
  });

  it("falls back to the raw criterion key when no label is provided", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewSummary, {
        scores: { "crit-unknown": 2 },
      }),
    );
    expect(html).toContain("crit-unknown");
    expect(html).toContain("2");
  });

  it("omits feedback and rejection sections when they are empty", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewSummary, {
        overallRecommendation: "Hire",
        feedback: "   ",
        rejectionRationale: "",
      }),
    );
    expect(html).not.toContain("Internal Feedback");
    expect(html).not.toContain("Rejection Rationale");
  });

  it("renders the footer note when provided", () => {
    const html = renderToStaticMarkup(
      createElement(ReviewSummary, {
        overallRecommendation: "No Hire",
        footerNote: "Submitted earlier this week.",
      }),
    );
    expect(html).toContain("Submitted earlier this week.");
  });
});
