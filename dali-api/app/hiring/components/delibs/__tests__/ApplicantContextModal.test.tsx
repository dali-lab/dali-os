import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewsSection, InterviewPrepNoteSection } from "../ApplicantContextModal";

function render(
  reviews: any[],
  criteriaByKey: Record<string, { label: string; maxScore?: number }> = {},
) {
  return renderToStaticMarkup(
    createElement(ReviewsSection, {
      reviews,
      criteriaByKey,
      fieldContext: {},
    }),
  );
}

describe("ReviewsSection — Internal Feedback / Rejection Rationale", () => {
  it("renders labeled feedback and rationale with the reviewer's content", () => {
    const html = render([
      {
        id: "rev-1",
        scores: {},
        feedback: "Strong communicator, weak on systems design.",
        rejectionRationale: "Did not meet the bar for the backend role.",
        overallRecommendation: "Lean No Hire",
        submittedAt: new Date("2026-04-01T00:00:00Z"),
        cycleReviewer: { user: { firstName: "Rev", lastName: "Iewer" } },
      },
    ]);

    expect(html).toContain("Internal Feedback");
    expect(html).toContain("Rejection Rationale");
    expect(html).toContain("Strong communicator, weak on systems design.");
    expect(html).toContain("Did not meet the bar for the backend role.");
    expect(html).not.toContain("No internal feedback provided");
    expect(html).not.toContain("No rejection rationale provided");
  });

  it("renders both labeled blocks with placeholders when the fields are empty", () => {
    const html = render([
      {
        id: "rev-1",
        scores: {},
        feedback: "",
        rejectionRationale: "",
        overallRecommendation: "Hire",
        submittedAt: new Date("2026-04-01T00:00:00Z"),
        cycleReviewer: { user: { firstName: "Rev", lastName: "Iewer" } },
      },
    ]);

    // Labels are always present so a lead can scan for them.
    expect(html).toContain("Internal Feedback");
    expect(html).toContain("Rejection Rationale");
    // Empty fields fall back to a muted placeholder instead of being omitted.
    expect(html).toContain("No internal feedback provided");
    expect(html).toContain("No rejection rationale provided");
  });

  it("shows the empty state when no reviewers are assigned", () => {
    const html = render([]);
    expect(html).toContain("No reviewers assigned yet.");
  });

  it("renders scores by iterating the review's own keys, resolving labels via the map", () => {
    const html = render(
      [
        {
          id: "rev-1",
          scores: { "crit-aaa": 5, "crit-bbb": 3 },
          feedback: "",
          rejectionRationale: "",
          overallRecommendation: "Hire",
          submittedAt: new Date("2026-04-01T00:00:00Z"),
          cycleReviewer: { user: { firstName: "Rev", lastName: "Iewer" } },
        },
      ],
      {
        "crit-aaa": { label: "Excitement towards learning", maxScore: 5 },
        "crit-bbb": { label: "Desire to collaborate", maxScore: 5 },
      },
    );
    // First word of the label + n/max, not the raw key.
    expect(html).toContain("Excitement: 5/5");
    expect(html).toContain("Desire: 3/5");
    expect(html).not.toContain("crit-aaa");
  });

  it("falls back to the raw key only when the map has no entry (orphaned criterion)", () => {
    const html = render(
      [
        {
          id: "rev-1",
          scores: { "crit-1778609863899": 4 },
          feedback: "",
          rejectionRationale: "",
          overallRecommendation: "Hire",
          submittedAt: new Date("2026-04-01T00:00:00Z"),
          cycleReviewer: { user: { firstName: "Rev", lastName: "Iewer" } },
        },
      ],
      {},
    );
    // No maxScore is appended when the criterion is unknown.
    expect(html).toContain("crit-1778609863899: 4");
    expect(html).not.toContain("crit-1778609863899: 4/");
  });
});

function renderNote(props: {
  editable: boolean;
  collabToken?: string | null;
  userName?: string;
  note: string | null;
}) {
  return renderToStaticMarkup(
    createElement(InterviewPrepNoteSection, {
      domainApplicationId: "da-1",
      ...props,
    }),
  );
}

describe("InterviewPrepNoteSection", () => {
  it("renders the collaborative editor when editable with a token + name", () => {
    const html = renderNote({
      editable: true,
      collabToken: "tok",
      userName: "Lead Person",
      note: null,
    });
    expect(html).toContain("Interview Prep Note");
    // CollaborativeEditor mounts client-side; SSR shows its loading placeholder.
    expect(html).toContain("Loading editor…");
    expect(html).not.toContain("Session expired");
  });

  it("shows a session-expired fallback when editable without a token", () => {
    const html = renderNote({ editable: true, collabToken: null, note: null });
    expect(html).toContain("Interview Prep Note");
    expect(html).toContain("Session expired");
  });

  it("renders the note read-only when not editable", () => {
    const html = renderNote({
      editable: false,
      note: "Ask about the migration rollback plan.",
    });
    expect(html).toContain("Interview Prep Note");
    expect(html).toContain("Ask about the migration rollback plan.");
    expect(html).not.toContain("Loading editor…");
  });

  it("renders nothing when not editable and the note is empty", () => {
    expect(renderNote({ editable: false, note: "" })).toBe("");
    expect(renderNote({ editable: false, note: "   " })).toBe("");
    expect(renderNote({ editable: false, note: null })).toBe("");
  });
});
