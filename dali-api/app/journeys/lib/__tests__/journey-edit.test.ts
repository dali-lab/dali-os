import { describe, expect, it } from "vitest";
import {
  addDependency,
  canAddDependency,
  changeQuestionType,
  createJourneyContent,
  createLab,
  createModule,
  createQuestion,
  createQuiz,
  dependsOnTransitively,
  MODULE_SPACING,
  removeDependency,
  removeModule,
  updateModule,
} from "../journey-edit";
import { ENTRY_FILE } from "../file-tree";
import { validateJourney } from "../journey-validation";
import { diamond, mod } from "./fixtures";

describe("dependencies", () => {
  it("follows prerequisites transitively", () => {
    expect(dependsOnTransitively(diamond(), "d", "a")).toBe(true);
    expect(dependsOnTransitively(diamond(), "a", "d")).toBe(false);
    expect(dependsOnTransitively(diamond(), "b", "c")).toBe(false);
  });

  it("refuses self links, duplicates, unknown modules and loops", () => {
    const j = diamond();
    expect(canAddDependency(j, "a", "a")).toBe(false);
    expect(canAddDependency(j, "b", "a")).toBe(false);
    expect(canAddDependency(j, "b", "nope")).toBe(false);
    expect(canAddDependency(j, "nope", "a")).toBe(false);
    expect(canAddDependency(j, "a", "d")).toBe(false);
    expect(canAddDependency(j, "c", "b")).toBe(true);
  });

  it("adds a valid dependency and leaves the journey alone otherwise", () => {
    const j = diamond();
    expect(addDependency(j, "c", "b").modules[2].dependsOn).toEqual(["a", "b"]);
    expect(addDependency(j, "a", "d")).toBe(j);
  });

  it("removes a dependency without touching the others", () => {
    expect(removeDependency(diamond(), "d", "b").modules[3].dependsOn).toEqual(["c"]);
  });

  it("drops a deleted module from every prerequisite list", () => {
    const j = removeModule(diamond(), "b");
    expect(j.modules.map((m) => m.id)).toEqual(["a", "c", "d"]);
    expect(j.modules[2].dependsOn).toEqual(["c"]);
  });

  it("updates one module by id and returns a new journey", () => {
    const j = diamond();
    const next = updateModule(j, "c", (m) => ({ ...m, title: "C!" }));
    expect(next.modules[2].title).toBe("C!");
    expect(j.modules[2].title).toBe("Module c");
  });
});

describe("new modules", () => {
  it("places a follow-up module to the right of its parent and links it", () => {
    const j = { modules: [mod("a", [], { position: { x: 100, y: 50 } })] };
    const m = createModule(j, "a");
    expect(m.dependsOn).toEqual(["a"]);
    expect(m.position).toEqual({ x: 100 + MODULE_SPACING.x, y: 50 });
  });

  it("stacks siblings under the first follow-up", () => {
    const j = { modules: [mod("a"), mod("b", ["a"])] };
    expect(createModule(j, "a").position.y).toBe(MODULE_SPACING.y);
  });

  it("puts an unlinked module past the right-most one", () => {
    const j = { modules: [mod("a", [], { position: { x: 400, y: 0 } })] };
    const m = createModule(j, null);
    expect(m.dependsOn).toEqual([]);
    expect(m.position.x).toBe(400 + MODULE_SPACING.x);
  });

  it("starts with one page and unique ids", () => {
    const a = createModule({ modules: [] }, null);
    const b = createModule({ modules: [] }, null);
    expect(a.pages).toHaveLength(1);
    expect(a.id).not.toBe(b.id);
  });
});

describe("starter content", () => {
  it("starts a journey with a Welcome module that can be published once titled", () => {
    const c = createJourneyContent();
    expect(c.modules.map((m) => m.title)).toEqual(["Welcome"]);
    expect(validateJourney(c)).toEqual([]);
  });

  it("gives a new lab an entry file and a checked step", () => {
    const lab = createLab();
    expect(lab.files[ENTRY_FILE]).toContain("<html>");
    expect(lab.defaultFile && lab.defaultFile in lab.files).toBe(true);
    expect(lab.steps[0].check).not.toBe("");
  });

  it("gives a new quiz one multiple choice question with its first option correct", () => {
    const quiz = createQuiz();
    const q = quiz.questions[0];
    expect(quiz.passingScore).toBe(80);
    expect(q.type === "multiple-choice" && q.correctOptionId === q.options[0].id).toBe(true);
  });

  it("keeps id, prompt and explanation when switching question type", () => {
    const q = { ...createQuestion("multiple-choice"), prompt: "Why?", explanation: "Because" };
    const switched = changeQuestionType(q, "short-answer");
    expect(switched).toMatchObject({ id: q.id, type: "short-answer", prompt: "Why?", explanation: "Because", acceptedAnswers: [""] });
    expect(changeQuestionType(q, "multiple-choice")).toBe(q);
  });
});
