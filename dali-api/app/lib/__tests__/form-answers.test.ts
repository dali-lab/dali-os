import { describe, it, expect } from "vitest";
import { isAnswered, findMissingRequired } from "../form-answers";
import type { Question } from "~/types";

function q(partial: Partial<Question> & { key: string }): Question {
  return {
    type: "text",
    required: false,
    data: { label: partial.key },
    ...partial,
  } as Question;
}

describe("isAnswered", () => {
  it("is false for an empty string", () => {
    expect(isAnswered("")).toBe(false);
  });

  it("is false for whitespace-only", () => {
    expect(isAnswered("   ")).toBe(false);
  });

  it("is false for undefined", () => {
    expect(isAnswered(undefined)).toBe(false);
  });

  it("is true for non-empty text", () => {
    expect(isAnswered("hi")).toBe(true);
  });

  it("treats info-type questions as always answered (prose, never an answer)", () => {
    const info = q({ key: "intro", type: "info", required: false });
    expect(isAnswered("", info)).toBe(true);
    expect(isAnswered(undefined, info)).toBe(true);
  });

  describe("skills_rating — delegates to isSkillsRatingComplete", () => {
    const skills = q({
      key: "skills",
      type: "skills_rating",
      required: true,
      data: { label: "Skills", options: ["React", "TypeScript"] },
    });

    it("is false when partially rated", () => {
      expect(isAnswered("React: 4\nTypeScript: -", skills)).toBe(false);
    });

    it("is false when unrated", () => {
      expect(isAnswered("React: -\nTypeScript: -", skills)).toBe(false);
      expect(isAnswered("", skills)).toBe(false);
    });

    it("is true when every skill has a 0–5 rating", () => {
      expect(isAnswered("React: 3\nTypeScript: 5", skills)).toBe(true);
    });

    it("is true when there are no skills to rate", () => {
      const noSkills = q({
        key: "skills",
        type: "skills_rating",
        required: true,
        data: { label: "Skills", options: [] },
      });
      expect(isAnswered("", noSkills)).toBe(true);
    });

    it("falls back to the plain trim check when no question is passed", () => {
      // Without the question arg, a serialized skills answer is just a non-empty string.
      expect(isAnswered("React: -\nTypeScript: -")).toBe(true);
    });
  });
});

describe("findMissingRequired", () => {
  const text = q({ key: "name", type: "text", required: true });
  const optional = q({ key: "bio", type: "textarea", required: false });
  const file = q({ key: "resume", type: "file", required: true });
  const skills = q({
    key: "skills",
    type: "skills_rating",
    required: true,
    data: { label: "Skills", options: ["React"] },
  });

  it("returns required-unanswered questions in order", () => {
    const questions = [text, optional, skills];
    const missing = findMissingRequired(questions, () => "");
    expect(missing.map((m) => m.key)).toEqual(["name", "skills"]);
  });

  it("excludes optional questions", () => {
    const missing = findMissingRequired([optional], () => "");
    expect(missing).toEqual([]);
  });

  it("excludes info questions even if something marked them required", () => {
    const requiredInfo = q({ key: "intro", type: "info", required: true });
    const missing = findMissingRequired([requiredInfo], () => "");
    expect(missing).toEqual([]);
  });

  it("treats answered required questions as satisfied", () => {
    const missing = findMissingRequired([text], (qq) => (qq.key === "name" ? "Ada" : ""));
    expect(missing).toEqual([]);
  });

  it("honors excludeFileType", () => {
    const withFile = findMissingRequired([text, file], () => "");
    expect(withFile.map((m) => m.key)).toEqual(["name", "resume"]);

    const withoutFile = findMissingRequired([text, file], () => "", {
      excludeFileType: true,
    });
    expect(withoutFile.map((m) => m.key)).toEqual(["name"]);
  });

  it("uses skills-rating awareness for required skills questions", () => {
    const missingPartial = findMissingRequired([skills], () => "React: -");
    expect(missingPartial.map((m) => m.key)).toEqual(["skills"]);

    const satisfied = findMissingRequired([skills], () => "React: 3");
    expect(satisfied).toEqual([]);
  });
});
