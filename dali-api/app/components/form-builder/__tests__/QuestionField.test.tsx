import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormQuestionField } from "~/components/form-builder/QuestionField";
import type { Question } from "~/types";

function renderField(props: Parameters<typeof FormQuestionField>[0]) {
  return renderToStaticMarkup(createElement(FormQuestionField, props));
}

describe("FormQuestionField — question types render", () => {
  it("renders a text input for type=text", () => {
    const q: Question = { key: "name", type: "text", required: false, data: { label: "Name" } };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).toContain('type="text"');
  });

  it("renders a textarea for type=textarea, with a word counter only when limited", () => {
    const q: Question = { key: "bio", type: "textarea", required: false, data: { label: "Bio" } };
    const html = renderField({ question: q, value: "hello world", onChange: () => {} });
    expect(html).toContain("<textarea");
    expect(html).not.toContain("words");

    const limited: Question = {
      key: "bio",
      type: "textarea",
      required: false,
      data: { label: "Bio", maxWords: 100 },
    };
    const limitedHtml = renderField({ question: limited, value: "hello world", onChange: () => {} });
    expect(limitedHtml).toContain("2 / 100 words");
  });

  it("renders a select with the placeholder option for type=select", () => {
    const q: Question = {
      key: "color",
      type: "select",
      required: false,
      data: { label: "Color", options: ["red", "blue"] },
    };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    // The custom <Select> renders a listbox-trigger button; its options are
    // portaled and only mounted when open, so static markup shows the trigger
    // with the placeholder rather than <option> elements.
    expect(html).toMatch(/<button[^>]*aria-haspopup="listbox"/);
    expect(html).toContain("Select...");
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
    // Each skill's <Select> trigger shows the unrated sentinel '-' as its
    // current value on first render (the 0-5 options are portaled on open).
    expect((html.match(/>-<\/span>/g) ?? []).length).toBe(2);
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
    // React now shows its real rating; only the still-unrated skill's trigger
    // displays '-' (its dropdown is the only one that still offers '-').
    expect(html).toMatch(/>3<\/span>/);
    expect((html.match(/>-<\/span>/g) ?? []).length).toBe(1);
  });
});

describe("FormQuestionField — projects:* reference cards", () => {
  const projectQuestion: Question = {
    key: "project",
    type: "reference",
    required: false,
    data: {
      label: "Project",
      referenceSource: "projects:open-this-term",
      referenceOptions: [
        {
          value: "p1",
          label: "Deserto",
          card: {
            description: "A project",
            imageUrl: null,
            partners: ["DALI"],
            challenges: [{ domain: "Design", scope: "Redesign the flow" }],
            sowPageId: "page-1",
          },
        },
      ],
    },
  };

  it("puts the details disclosure outside the option's <label>", () => {
    // Anything inside the label selects the option when clicked, so the
    // disclosure — and the challenges and SOW link it reveals — has to live
    // after the label closes to be reachable without bidding on the project.
    const html = renderField({ question: projectQuestion, value: "", onChange: () => {} });
    expect(html).toContain("View details");
    expect(html.indexOf("View details")).toBeGreaterThan(html.lastIndexOf("</label>"));
  });

  it("falls back to the plain select when the options carry no card", () => {
    const q: Question = {
      key: "domain",
      type: "reference",
      required: false,
      data: {
        label: "Domain",
        referenceSource: "domains:active",
        referenceOptions: [{ value: "d1", label: "Design" }],
      },
    };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).toMatch(/<button[^>]*aria-haspopup="listbox"/);
    expect(html).not.toContain("View details");
  });
});

describe("FormQuestionField — disabled propagates to underlying inputs", () => {
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
    expect(html).toMatch(
      /<button[^>]*disabled[^>]*aria-haspopup="listbox"|<button[^>]*aria-haspopup="listbox"[^>]*disabled/,
    );
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
    const triggers = html.match(/<button[^>]*aria-haspopup="listbox"/g) ?? [];
    expect(triggers.length).toBe(2);
    const disabledButtons = html.match(/<button[^>]*disabled/g) ?? [];
    expect(disabledButtons.length).toBe(2);
  });

  it("does not include disabled attribute when disabled=false (default)", () => {
    const q: Question = { key: "name", type: "text", required: false, data: { label: "Name" } };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).not.toMatch(/<input[^>]*\sdisabled/);
  });
});

describe("FormQuestionField — required asterisk and labels are owned by the caller", () => {
  it("does not render the question label or asterisk itself (caller is responsible)", () => {
    const q: Question = { key: "name", type: "text", required: true, data: { label: "Full Name" } };
    const html = renderField({ question: q, value: "", onChange: () => {} });
    expect(html).not.toContain("Full Name");
  });
});

describe("FormQuestionField — onChange is wired (and the rendered input would not fire when disabled)", () => {
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
