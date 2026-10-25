import { describe, expect, it } from "vitest";
import { validateJourney } from "../journey-validation";
import { createQuestion } from "../journey-edit";
import type { JourneyContent } from "../types";
import { mod } from "./fixtures";

const journey = (modules = [mod("a")], title = "J"): JourneyContent => ({ title, description: "", modules });
const messages = (j: JourneyContent) => validateJourney(j).map((i) => i.message);

describe("validateJourney", () => {
  it("passes a titled journey with titled modules and pages", () => {
    expect(validateJourney(journey())).toEqual([]);
  });

  it("needs a title and at least one module, reported against no module", () => {
    expect(validateJourney(journey([], " "))).toEqual([
      { moduleId: null, message: "The journey needs a title." },
      { moduleId: null, message: "The journey has no modules." },
    ]);
  });

  it("needs module titles, pages and page titles", () => {
    const m = mod("a", [], { title: "", pages: [] });
    expect(messages(journey([m]))).toEqual(["A module is missing a title.", "Untitled module needs at least one page."]);
    const p = mod("b", [], { pages: [{ id: "p", title: " ", content: [] }] });
    expect(messages(journey([p]))).toEqual(["Module b: page 1 is missing a title."]);
  });

  it("checks labs for an entry file, steps and checks", () => {
    const m = mod("a", [], { lab: { title: "L", intro: "", files: {}, steps: [{ id: "s", title: "S", instructions: "", check: "" }] } });
    expect(messages(journey([m]))).toEqual(["Module a: the lab needs an index.html file.", "Module a: lab step 1 has no check."]);
    const empty = mod("a", [], { lab: { title: "L", intro: "", files: { "index.html": "" }, steps: [] } });
    expect(messages(journey([empty]))).toEqual(["Module a: the lab needs at least one step."]);
  });

  it("checks slides for titles and images", () => {
    const m = mod("a", [], {
      slides: [
        { id: "1", layout: "content", title: "" },
        { id: "2", layout: "image", title: "", image: { src: "", alt: "" } },
        { id: "3", layout: "split", title: "Ok", image: { src: "/x.jpg", alt: "" } },
      ],
    });
    expect(messages(journey([m]))).toEqual(["Module a: slide 1 needs a title.", "Module a: slide 2 needs an image."]);
  });

  it("checks quizzes for questions, prompts, options and a correct answer", () => {
    const q = createQuestion("multiple-choice");
    const broken = { ...q, prompt: "", options: [{ id: "o", text: "" }], correctOptionId: "missing" };
    const m = mod("a", [], { quiz: { title: "Q", intro: "", passingScore: 80, questions: [broken as never] } });
    expect(messages(journey([m]))).toEqual([
      "Module a: quiz question 1 has no prompt.",
      "Module a: quiz question 1 needs at least two options.",
      "Module a: quiz question 1 has an empty option.",
      "Module a: quiz question 1 has no correct answer selected.",
    ]);
    const none = mod("a", [], { quiz: { title: "Q", intro: "", passingScore: 80, questions: [] } });
    expect(messages(journey([none]))).toEqual(["Module a: the quiz needs at least one question."]);
  });

  it("attaches module issues to their module", () => {
    expect(validateJourney(journey([mod("a", [], { title: "" })]))[0].moduleId).toBe("a");
  });
});
