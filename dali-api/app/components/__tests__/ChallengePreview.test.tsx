import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChallengePreview } from "../ChallengePreview";
import type { Question } from "~/types";

const allTypes: Question[] = [
  { key: "name", type: "text", required: true, data: { label: "Full Name" } },
  { key: "bio", type: "textarea", required: false, data: { label: "Tell us about yourself" } },
  {
    key: "color",
    type: "select",
    required: true,
    data: { label: "Favorite Color", options: ["red", "blue"] },
  },
  { key: "resume", type: "file", required: false, data: { label: "Resume" } },
  {
    key: "skills",
    type: "skills_rating",
    required: false,
    data: { label: "Skills", options: ["React"] },
  },
  { key: "gh", type: "github_url", required: false, data: { label: "Repo URL" } },
  { key: "fig", type: "figma_url", required: false, data: { label: "Design URL" } },
  { key: "drv", type: "drive_url", required: false, data: { label: "Drive URL" } },
];

describe("ChallengePreview", () => {
  it("renders each question's label", () => {
    const html = renderToStaticMarkup(
      createElement(ChallengePreview, { questions: allTypes }),
    );
    for (const q of allTypes) {
      expect(html).toContain(q.data.label);
    }
  });

  it("renders the disabled-fields preview note", () => {
    const html = renderToStaticMarkup(
      createElement(ChallengePreview, { questions: [] }),
    );
    expect(html).toContain("Preview");
    expect(html).toContain("disabled");
  });

  it("renders an empty-state when there are no questions", () => {
    const html = renderToStaticMarkup(
      createElement(ChallengePreview, { questions: [] }),
    );
    expect(html).toContain("No questions in this version.");
  });

  it("renders all interactive controls in a disabled state so applicants' real form is mirrored without being editable", () => {
    const html = renderToStaticMarkup(
      createElement(ChallengePreview, { questions: allTypes }),
    );
    // text + url inputs
    const inputMatches = html.match(/<input[^>]*disabled/g) ?? [];
    expect(inputMatches.length).toBeGreaterThanOrEqual(3);
    // textarea
    expect(html).toMatch(/<textarea[^>]*disabled/);
    // select(s) — at least the type=select question + the skills-rating selects
    expect(html).toMatch(/<select[^>]*disabled/);
    // file upload button (the button wraps an svg, then the text)
    expect(html).toMatch(/<button[^>]*disabled[\s\S]*?Choose file to upload/);
  });

  it("flags required questions with a red asterisk", () => {
    const html = renderToStaticMarkup(
      createElement(ChallengePreview, { questions: allTypes }),
    );
    // Two required questions in the fixture.
    const asteriskCount = (html.match(/text-accent-coral/g) ?? []).length;
    expect(asteriskCount).toBeGreaterThanOrEqual(2);
  });

  it("flags afterDomains questions with the after-domains badge", () => {
    const afterQ: Question = {
      key: "ref",
      type: "text",
      required: false,
      data: { label: "References", afterDomains: true },
    };
    const html = renderToStaticMarkup(
      createElement(ChallengePreview, { questions: [afterQ] }),
    );
    expect(html).toContain("Shown after domain questions");
  });
});
