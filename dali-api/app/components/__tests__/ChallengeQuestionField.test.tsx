import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChallengeQuestionField } from "../ChallengeQuestionField";
import type { Question } from "~/types";

function renderField(props: Parameters<typeof ChallengeQuestionField>[0]) {
  return renderToStaticMarkup(createElement(ChallengeQuestionField, props));
}

describe("ChallengeQuestionField — question types render", () => {
  it("renders a text input for type=text", () => {
    const q: Question = { key: "name", type: "text", required: false, data: { label: "Name" } };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).toContain('type="text"');
  });

  it("renders a textarea for type=textarea with a word counter", () => {
    const q: Question = { key: "bio", type: "textarea", required: false, data: { label: "Bio" } };
    const html = renderField({ question: q, value: "hello world", onChange: () => {} });
    expect(html).toContain("<textarea");
    expect(html).toContain("2 words");
  });

  it("renders a select with the placeholder option for type=select", () => {
    const q: Question = {
      key: "color",
      type: "select",
      required: false,
      data: { label: "Color", options: ["red", "blue"] },
    };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).toContain("<select");
    expect(html).toContain(">Select...</option>");
    expect(html).toContain(">red</option>");
    expect(html).toContain(">blue</option>");
  });

  it("renders a url input for type=github_url with the github placeholder", () => {
    const q: Question = { key: "gh", type: "github_url", required: false, data: { label: "GH" } };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).toContain('type="url"');
    expect(html).toContain("github.com/owner/repo");
  });

  it("renders a url input for type=figma_url with the figma placeholder", () => {
    const q: Question = { key: "fig", type: "figma_url", required: false, data: { label: "Fig" } };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).toContain('type="url"');
    expect(html).toContain("figma.com/file/");
  });

  it("renders a url input for type=drive_url with the drive placeholder", () => {
    const q: Question = { key: "drv", type: "drive_url", required: false, data: { label: "Drive" } };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).toContain('type="url"');
    expect(html).toContain("drive.google.com/file/d/");
  });

  it("renders the file upload chrome for type=file when no file is set", () => {
    const q: Question = { key: "resume", type: "file", required: false, data: { label: "Resume" } };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).toContain("Choose file to upload");
  });

  it("renders the skills rating grid with each skill defaulting to '-' for type=skills_rating", () => {
    const q: Question = {
      key: "skills",
      type: "skills_rating",
      required: false,
      data: { label: "Skills", options: ["React", "TypeScript"] },
    };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).toContain("React");
    expect(html).toContain("TypeScript");
    // The unrated sentinel appears once per skill on first render.
    expect(html.match(/>-<\/option>/g)?.length ?? 0).toBe(2);
    // Each row still offers 0-5 as valid ratings.
    expect(html.match(/>0<\/option>/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html.match(/>5<\/option>/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("drops the '-' option for a skill once it has a real rating", () => {
    const q: Question = {
      key: "skills",
      type: "skills_rating",
      required: false,
      data: { label: "Skills", options: ["React", "TypeScript"] },
    };
    const html = renderField({
      question: q,
      value: "React: 3\nTypeScript: -",
      onChange: () => {},
    });
    // Only the unrated skill still has '-' as an option.
    expect(html.match(/>-<\/option>/g)?.length ?? 0).toBe(1);
  });
});

describe("ChallengeQuestionField — disabled propagates to underlying inputs", () => {
  it("text input is disabled and aria-disabled when disabled=true", () => {
    const q: Question = { key: "name", type: "text", required: false, data: { label: "Name" } };
    const html = renderField({ question: q, value: "", onChange: () => {}, disabled: true });
    expect(html).toContain("disabled");
    expect(html).toContain('aria-disabled="true"');
  });

  it("textarea is disabled when disabled=true", () => {
    const q: Question = { key: "bio", type: "textarea", required: false, data: { label: "Bio" } };
    const html = renderField({ question: q, value: "", onChange: () => {}, disabled: true });
    expect(html).toContain("<textarea");
    expect(html).toMatch(/<textarea[^>]*disabled/);
  });

  it("select is disabled when disabled=true", () => {
    const q: Question = {
      key: "color",
      type: "select",
      required: false,
      data: { label: "Color", options: ["red"] },
    };
    const html = renderField({ question: q, value: "", onChange: () => {}, disabled: true });
    expect(html).toMatch(/<select[^>]*disabled/);
  });

  it("file upload trigger button is disabled when disabled=true", () => {
    const q: Question = { key: "resume", type: "file", required: false, data: { label: "Resume" } };
    const html = renderField({ question: q, value: "", onChange: () => {}, disabled: true });
    expect(html).toContain("Choose file to upload");
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("skills rating selects are all disabled when disabled=true", () => {
    const q: Question = {
      key: "skills",
      type: "skills_rating",
      required: false,
      data: { label: "Skills", options: ["React", "Vue"] },
    };
    const html = renderField({ question: q, value: "", onChange: () => {}, disabled: true });
    const selectMatches = html.match(/<select[^>]*disabled/g) ?? [];
    expect(selectMatches.length).toBe(2);
  });

  it("does not include disabled attribute when disabled=false (default)", () => {
    const q: Question = { key: "name", type: "text", required: false, data: { label: "Name" } };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).not.toMatch(/<input[^>]*\sdisabled/);
  });
});

describe("ChallengeQuestionField — required asterisk and labels are owned by the caller", () => {
  it("does not render the question label or asterisk itself (caller is responsible)", () => {
    const q: Question = { key: "name", type: "text", required: true, data: { label: "Full Name" } };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).not.toContain("Full Name");
  });
});

describe("ChallengeQuestionField — onChange is wired (and the rendered input would not fire when disabled)", () => {
  it("the underlying disabled input prevents change events from being dispatched in the browser", () => {
    // We can't dispatch real events in renderToStaticMarkup; we assert the
    // disabled attribute is present, which is what makes the browser block
    // the change event. Behavior contract under test: disabled controls
    // ignore user input, so the onChange handler is never reached.
    const onChange = vi.fn();
    const q: Question = { key: "name", type: "text", required: false, data: { label: "Name" } };
    const html = renderField({ question: q, value: "", onChange, disabled: true });
    expect(html).toMatch(/<input[^>]*disabled/);
    expect(onChange).not.toHaveBeenCalled();
  });
});
