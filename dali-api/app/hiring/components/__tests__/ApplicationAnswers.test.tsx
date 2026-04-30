import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerDisplay, QuestionList, renderSkillsRating } from "../ApplicationAnswers";
import type { Question } from "~/types";

const fileQ: Question = {
  key: "resume",
  type: "file",
  required: false,
  data: { label: "Resume" },
};

describe("AnswerDisplay file rendering", () => {
  it("renders a clickable download link when presigned=true (default)", () => {
    const html = renderToStaticMarkup(
      createElement(AnswerDisplay, {
        question: fileQ,
        answer: "https://s3.example.com/applications/resume/abc-Resume.pdf?X-Amz-Signature=...",
      }),
    );
    expect(html).toContain("<a ");
    expect(html).toContain("href=");
    expect(html).toContain("Resume.pdf");
  });

  it("renders filename-only (no link, no signed-URL leakage) when presigned=false", () => {
    const html = renderToStaticMarkup(
      createElement(AnswerDisplay, {
        question: fileQ,
        answer: "applications/resume/abc-Resume.pdf",
        presigned: false,
      }),
    );
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
    expect(html).toContain("Resume.pdf");
  });

  it("renders an em-dash for empty file answers regardless of presigned mode", () => {
    const empty = renderToStaticMarkup(
      createElement(AnswerDisplay, { question: fileQ, answer: "", presigned: false }),
    );
    expect(empty).toContain("—");
  });
});

describe("AnswerDisplay non-file types are unaffected by presigned mode", () => {
  it("renders github_url as a link in both modes", () => {
    const q: Question = { key: "gh", type: "github_url", required: false, data: { label: "GH" } };
    const linked = renderToStaticMarkup(
      createElement(AnswerDisplay, { question: q, answer: "https://github.com/x/y", presigned: true }),
    );
    const unlinked = renderToStaticMarkup(
      createElement(AnswerDisplay, { question: q, answer: "https://github.com/x/y", presigned: false }),
    );
    expect(linked).toContain('href="https://github.com/x/y"');
    expect(unlinked).toContain('href="https://github.com/x/y"');
  });

  it("renders drive_url as a link in both modes", () => {
    const q: Question = { key: "drv", type: "drive_url", required: false, data: { label: "Drive" } };
    const driveAnswer = "https://drive.google.com/file/d/abc123/view";
    const linked = renderToStaticMarkup(
      createElement(AnswerDisplay, { question: q, answer: driveAnswer, presigned: true }),
    );
    const unlinked = renderToStaticMarkup(
      createElement(AnswerDisplay, { question: q, answer: driveAnswer, presigned: false }),
    );
    expect(linked).toContain(`href="${driveAnswer}"`);
    expect(unlinked).toContain(`href="${driveAnswer}"`);
  });

  it("renders text answers as plain content", () => {
    const q: Question = { key: "name", type: "text", required: false, data: { label: "Name" } };
    const html = renderToStaticMarkup(
      createElement(AnswerDisplay, { question: q, answer: "Carol Patel", presigned: false }),
    );
    expect(html).toContain("Carol Patel");
  });
});

describe("renderSkillsRating", () => {
  it("renders an em-dash for an empty value", () => {
    const html = renderToStaticMarkup(
      createElement("div", null, renderSkillsRating("")),
    );
    expect(html).toContain("—");
  });

  it("parses 'Skill: N\\nSkill: N' into rating cells", () => {
    const html = renderToStaticMarkup(
      createElement("div", null, renderSkillsRating("React: 4\nTypeScript: 5")),
    );
    expect(html).toContain("React");
    expect(html).toContain("TypeScript");
    expect(html).toContain(">4<");
    expect(html).toContain(">5<");
  });
});

describe("QuestionList — review-mode rendering of every question type", () => {
  // This is what the review modal renders before submission. It must show:
  // - the question label for every question
  // - the answer (or em-dash for unanswered)
  // - file answers as filenames only (no link) so reviewers don't see a broken
  //   non-presigned link in the pre-submit review.
  it("renders all question labels and answers, with file as filename-only", () => {
    const questions: Question[] = [
      { key: "name", type: "text", required: true, data: { label: "Full name" } },
      { key: "essay", type: "textarea", required: true, data: { label: "Why DALI?" } },
      { key: "year", type: "select", required: false, data: { label: "Class year", options: ["2026", "2027"] } },
      { key: "gh", type: "github_url", required: false, data: { label: "GitHub" } },
      { key: "resume", type: "file", required: false, data: { label: "Resume" } },
      { key: "skills", type: "skills_rating", required: false, data: { label: "Skills", options: ["React", "Go"] } },
      { key: "blank", type: "text", required: false, data: { label: "Optional notes" } },
    ];
    const answers: Record<string, string> = {
      name: "Carol Patel",
      essay: "I love building things.",
      year: "2026",
      gh: "https://github.com/carol/x",
      resume: "applications/resume/abc-Resume.pdf",
      skills: "React: 4\nGo: 2",
      // blank intentionally missing
    };

    const html = renderToStaticMarkup(
      createElement(QuestionList, { questions, answers, presigned: false }),
    );

    // Every label appears
    for (const q of questions) {
      expect(html).toContain(q.data.label);
    }
    // Answers appear
    expect(html).toContain("Carol Patel");
    expect(html).toContain("I love building things.");
    expect(html).toContain("2026");
    expect(html).toContain("https://github.com/carol/x");
    expect(html).toContain("Resume.pdf");
    // The unanswered question shows the em-dash placeholder
    expect(html).toContain("—");
    // File answer in review mode does NOT render a download link to the raw key.
    expect(html).not.toContain('href="applications/resume/abc-Resume.pdf"');
  });

  it("renders the empty-state message when there are no questions", () => {
    const html = renderToStaticMarkup(
      createElement(QuestionList, { questions: [], answers: {} }),
    );
    expect(html).toContain("No questions in this section.");
  });
});
