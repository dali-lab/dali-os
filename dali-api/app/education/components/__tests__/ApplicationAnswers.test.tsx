import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApplicationAnswers } from "../ApplicationAnswers";
import type { Question } from "~/types";

const questions: Question[] = [
  { key: "diet", type: "select", required: true, data: { label: "Diet", options: ["None", "Other"] } },
  {
    key: "details",
    type: "text",
    required: true,
    data: { label: "Dietary details", showIf: { questionKey: "diet", op: "is", value: "Other" } },
  },
];
const html = (answers: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(ApplicationAnswers, { questions, answers }));

describe("ApplicationAnswers with rules", () => {
  it("omits a question that was not asked", () => {
    const out = html({ diet: "None" });
    expect(out).toContain("Diet");
    expect(out).not.toContain("Dietary details");
  });

  it("shows a question that was asked, with No answer when blank", () => {
    const out = html({ diet: "Other" });
    expect(out).toContain("Dietary details");
    expect(out).toContain("No answer");
  });

  it("is unchanged for a form without rules", () => {
    const out = renderToStaticMarkup(
      createElement(ApplicationAnswers, { questions: [questions[0]], answers: {} }),
    );
    expect(out).toContain("Diet");
    expect(out).toContain("No answer");
  });
});
