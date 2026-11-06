import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionSourceNote } from "~/components/form-builder/QuestionSourceNote";
import type { Question } from "~/types";

const render = (question: Question) => renderToStaticMarkup(createElement(QuestionSourceNote, { question }));
const q = (type: Question["type"], data: Partial<Question["data"]> = {}): Question => ({
  key: "k",
  type,
  required: true,
  data: { label: "Q", ...data },
});

describe("QuestionSourceNote", () => {
  it("says what a question fills in from", () => {
    expect(render(q("text", { prefill: "partnerOrg.name" }))).toContain("Fills in their organization&#x27;s name");
  });

  it("names a Database list's source and its prefill together", () => {
    const html = render(
      q("reference", { referenceSource: "projects:my-organization", prefill: "partnerOrg.project" }),
    );
    expect(html).toContain("Choices from Projects of my organization (partners). Fills in their project, when they have just one");
  });

  it("renders nothing for a plain question or a prefill that doesn't fit", () => {
    expect(render(q("text"))).toBe("");
    expect(render(q("radio", { prefill: "me.name" }))).toBe("");
  });
});
