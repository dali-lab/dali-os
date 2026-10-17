import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewsCard, type ReviewsCardReview } from "../ReviewsCard";

const review = (id: string, reviewerName: string, feedback: string): ReviewsCardReview => ({
  id,
  reviewerName,
  feedback,
  overallRecommendation: "Hire",
  scores: { c1: 4 },
  submittedAt: "2026-10-01T12:00:00.000Z",
});

const render = (props: Partial<Parameters<typeof ReviewsCard>[0]>) =>
  renderToStaticMarkup(
    createElement(ReviewsCard, {
      reviews: [review("r1", "Rae One", "Strong portfolio"), review("r2", "Sam Two", "Needs depth")],
      criteria: { c1: { label: "Craft", maxScore: 5 } },
      selectedId: null,
      onSelect: () => {},
      ...props,
    }),
  );

describe("ReviewsCard", () => {
  it("says so and shows no picker when nothing is submitted", () => {
    const html = render({ reviews: [] });
    expect(html).toContain("No submitted reviews yet.");
    expect(html).not.toContain("Reviewer");
  });

  it("opens on the first review when none is selected", () => {
    const html = render({});
    expect(html).toContain("2 submitted");
    expect(html).toContain("Strong portfolio");
    expect(html).not.toContain("Needs depth");
  });

  it("shows the selected review", () => {
    const html = render({ selectedId: "r2" });
    expect(html).toContain("Needs depth");
    expect(html).not.toContain("Strong portfolio");
  });

  it("falls back to the first review when the selected id is stale", () => {
    expect(render({ selectedId: "gone" })).toContain("Strong portfolio");
  });

  it("appends the page's footer copy after the submitted date", () => {
    expect(render({ footerSuffix: " Highlights appear inline." })).toContain("Highlights appear inline.");
  });
});
