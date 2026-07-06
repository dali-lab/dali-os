import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormField, FormFieldList } from "../FormField";
import type { Question } from "~/types";

const noop = () => {};

describe("FormField", () => {
  it("renders an info-type question as a muted prose block, not a text input", () => {
    const infoQ: Question = {
      key: "intro",
      type: "info",
      required: false,
      data: { label: "", body: "Read this before answering." },
    };
    const html = renderToStaticMarkup(
      createElement(FormField, { question: infoQ, value: "", onChange: noop }),
    );
    expect(html).toContain("Read this before answering.");
    expect(html).toContain("bg-muted/30");
    expect(html).not.toMatch(/<input[^>]*type="text"/);
    // No label / required star on a prose block.
    expect(html).not.toContain("text-accent-coral");
  });

  it("renders exactly one standardized required asterisk for a required question", () => {
    const reqQ: Question = {
      key: "name",
      type: "text",
      required: true,
      data: { label: "Full Name" },
    };
    const html = renderToStaticMarkup(
      createElement(FormField, { question: reqQ, value: "", onChange: noop }),
    );
    const stars = html.match(/text-accent-coral ml-0\.5/g) ?? [];
    expect(stars.length).toBe(1);
    // The legacy text-destructive star must be gone.
    expect(html).not.toContain("text-destructive");
  });

  it("renders no asterisk for an optional question", () => {
    const optQ: Question = {
      key: "bio",
      type: "textarea",
      required: false,
      data: { label: "Bio" },
    };
    const html = renderToStaticMarkup(
      createElement(FormField, { question: optQ, value: "", onChange: noop }),
    );
    expect(html).not.toContain("text-accent-coral");
  });

  it("uses the renderField override instead of the default field renderer", () => {
    const fileQ: Question = {
      key: "resume",
      type: "file",
      required: false,
      data: { label: "Resume" },
    };
    const html = renderToStaticMarkup(
      createElement(FormField, {
        question: fileQ,
        value: "",
        onChange: noop,
        renderField: () =>
          createElement("div", null, "File uploads aren't available here."),
      }),
    );
    expect(html).toContain("File uploads aren&#x27;t available here.");
    // Default file upload button must not appear.
    expect(html).not.toContain("Choose file to upload");
  });

  it("passes disabled through to the default field renderer", () => {
    const reqQ: Question = {
      key: "name",
      type: "text",
      required: true,
      data: { label: "Full Name" },
    };
    const html = renderToStaticMarkup(
      createElement(FormField, {
        question: reqQ,
        value: "",
        onChange: noop,
        disabled: true,
      }),
    );
    expect(html).toMatch(/<input[^>]*disabled/);
  });

  it("renders the labelSuffix slot", () => {
    const reqQ: Question = {
      key: "name",
      type: "text",
      required: false,
      data: { label: "Full Name" },
    };
    const html = renderToStaticMarkup(
      createElement(FormField, {
        question: reqQ,
        value: "",
        onChange: noop,
        labelSuffix: createElement("span", null, "Shown after domain questions"),
      }),
    );
    expect(html).toContain("Shown after domain questions");
  });

  it("renders the belowField slot below the field", () => {
    const reqQ: Question = {
      key: "url",
      type: "github_url",
      required: false,
      data: { label: "Repo" },
    };
    const html = renderToStaticMarkup(
      createElement(FormField, {
        question: reqQ,
        value: "",
        onChange: noop,
        belowField: createElement("p", null, "Over the word limit"),
      }),
    );
    expect(html).toContain("Over the word limit");
  });

  it("applies a custom id to the wrapper for scroll anchoring", () => {
    const reqQ: Question = {
      key: "name",
      type: "text",
      required: false,
      data: { label: "Full Name" },
    };
    const html = renderToStaticMarkup(
      createElement(FormField, {
        question: reqQ,
        value: "",
        onChange: noop,
        id: "question-name",
      }),
    );
    expect(html).toContain('id="question-name"');
  });
});

describe("FormFieldList", () => {
  const questions: Question[] = [
    { key: "name", type: "text", required: true, data: { label: "Full Name" } },
    {
      key: "intro",
      type: "info",
      required: false,
      data: { label: "", body: "An info block." },
    },
    { key: "bio", type: "textarea", required: false, data: { label: "Bio" } },
  ];

  it("renders each question, with info as prose", () => {
    const html = renderToStaticMarkup(
      createElement(FormFieldList, { questions }),
    );
    expect(html).toContain("Full Name");
    expect(html).toContain("An info block.");
    expect(html).toContain("Bio");
  });

  it("respects labelClassName for every field", () => {
    const html = renderToStaticMarkup(
      createElement(FormFieldList, { questions, labelClassName: "font-semibold" }),
    );
    expect(html).toContain("font-semibold");
  });
});
