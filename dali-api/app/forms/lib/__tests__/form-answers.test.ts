import { describe, it, expect } from "vitest";
import {
  MAX_FILES_PER_QUESTION,
  fileAnswerName,
  fileCountError,
  isAnswered,
  findMissingRequired,
  maxFilesFor,
  parseFileAnswer,
  serializeFileAnswer,
  hasNothingToPick,
  isLayoutOnly,
  isValidIsoDate,
  isValidOtherText,
  normalizeAnswerFormats,
  validateAnswerFormats,
} from "../form-answers";
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

  it("treats pageBreak dividers as always answered (layout-only)", () => {
    const brk = q({ key: "pb", type: "pageBreak", required: false });
    expect(isAnswered("", brk)).toBe(true);
    expect(isAnswered(undefined, brk)).toBe(true);
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

describe("isLayoutOnly", () => {
  it("is true for info and pageBreak, false for real question types", () => {
    expect(isLayoutOnly("info")).toBe(true);
    expect(isLayoutOnly("pageBreak")).toBe(true);
    expect(isLayoutOnly("text")).toBe(false);
    expect(isLayoutOnly("checkbox")).toBe(false);
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

  it("excludes pageBreak dividers", () => {
    const brk = q({ key: "pb", type: "pageBreak", required: true });
    const missing = findMissingRequired([brk, text], () => "");
    expect(missing.map((m) => m.key)).toEqual(["name"]);
  });

  it("treats answered required questions as satisfied", () => {
    const missing = findMissingRequired([text], (qq) => (qq.key === "name" ? "Ada" : ""));
    expect(missing).toEqual([]);
  });

  it("counts a required file as missing until it has an upload", () => {
    expect(findMissingRequired([text, file], () => "").map((m) => m.key)).toEqual(["name", "resume"]);
    expect(findMissingRequired([file], () => "[]").map((m) => m.key)).toEqual(["resume"]);
    expect(findMissingRequired([file], () => '["uploads/applications/resume/a.pdf"]')).toEqual([]);
    expect(findMissingRequired([file], () => "uploads/applications/resume/a.pdf")).toEqual([]);
  });

  it("uses skills-rating awareness for required skills questions", () => {
    const missingPartial = findMissingRequired([skills], () => "React: -");
    expect(missingPartial.map((m) => m.key)).toEqual(["skills"]);

    const satisfied = findMissingRequired([skills], () => "React: 3");
    expect(satisfied).toEqual([]);
  });
});

function typed(type: Question["type"], data: Partial<Question["data"]> = {}): Question {
  return { key: "k", type, required: false, data: { label: "Q", ...data } };
}

const errorsFor = (question: Question, value: unknown) =>
  validateAnswerFormats([question], { k: value });

describe("validateAnswerFormats", () => {
  describe("date", () => {
    it.each(["2026-11-02", "2024-02-29", "1999-12-31"])("accepts %s", (v) => {
      expect(errorsFor(typed("date"), v)).toEqual([]);
    });
    it.each(["2026-13-01", "2026-02-30", "2025-02-29", "11/02/2026", "2026-1-2", "tomorrow", "2026-11-02T10:00"])(
      "rejects %s",
      (v) => {
        expect(errorsFor(typed("date"), v)).toEqual([
          { key: "k", message: '"Q": enter a valid date.' },
        ]);
      },
    );
    it.each([undefined, null, "", "   "])("treats %j as empty", (v) => {
      expect(errorsFor(typed("date"), v)).toEqual([]);
    });
  });

  describe("number", () => {
    it.each(["0", "42", "-7", "3.14", " 12 ", "-0.5"])("accepts %j", (v) => {
      expect(errorsFor(typed("number"), v)).toEqual([]);
    });
    it.each(["abc", "1e5", "1,000", "1.", ".5", "--1", "NaN", "Infinity", "12 3"])("rejects %j", (v) => {
      expect(errorsFor(typed("number"), v)).toEqual([{ key: "k", message: '"Q": enter a number.' }]);
    });
    it("enforces min", () => {
      const q = typed("number", { min: 5 });
      expect(errorsFor(q, "5")).toEqual([]);
      expect(errorsFor(q, "4.99")).toEqual([{ key: "k", message: '"Q": must be at least 5.' }]);
    });
    it("enforces max", () => {
      const q = typed("number", { max: 10 });
      expect(errorsFor(q, "10")).toEqual([]);
      expect(errorsFor(q, "10.01")).toEqual([{ key: "k", message: '"Q": must be at most 10.' }]);
    });
    it("allows a min of zero and negative bounds", () => {
      const q = typed("number", { min: 0, max: 0 });
      expect(errorsFor(q, "0")).toEqual([]);
      expect(errorsFor(q, "-1")).toHaveLength(1);
      expect(errorsFor(typed("number", { min: -5 }), "-5")).toEqual([]);
    });
    it("accepts anything numeric with no bounds", () => {
      expect(errorsFor(typed("number"), "-99999999")).toEqual([]);
    });
    it("treats blank as empty", () => {
      expect(errorsFor(typed("number", { min: 1 }), "")).toEqual([]);
    });
  });

  describe("email", () => {
    it.each(["ada@example.edu", "Ada.Lovelace+x@Example.EDU", "  ada@example.edu  ", "a@b.co.uk"])(
      "accepts %j",
      (v) => {
        expect(errorsFor(typed("email"), v)).toEqual([]);
      },
    );
    it.each(["ada", "ada@", "@example.edu", "ada@example", "ada @example.edu", "ada@@example.edu", "ada@example..edu", "ada@.edu"])(
      "rejects %j",
      (v) => {
        expect(errorsFor(typed("email"), v)).toEqual([
          { key: "k", message: '"Q": enter a valid email address.' },
        ]);
      },
    );
    it("treats blank as empty", () => {
      expect(errorsFor(typed("email"), "  ")).toEqual([]);
    });
  });

  describe("scale", () => {
    it.each(["1", "2", "3", "4", "5"])("accepts %s", (v) => {
      expect(errorsFor(typed("scale"), v)).toEqual([]);
    });
    it.each(["0", "6", "3.5", "-1", "five", "10"])("rejects %s", (v) => {
      expect(errorsFor(typed("scale"), v)).toEqual([
        { key: "k", message: '"Q": pick a number from 1 to 5.' },
      ]);
    });
    it("treats blank as empty", () => {
      expect(errorsFor(typed("scale"), "")).toEqual([]);
    });
  });

  describe("radio", () => {
    const radio = typed("radio", { options: ["Red", "Blue"] });
    it("accepts a listed option", () => {
      expect(errorsFor(radio, "Red")).toEqual([]);
    });
    it("rejects an unlisted value without allowOther", () => {
      expect(errorsFor(radio, "Green")).toEqual([
        { key: "k", message: '"Q": that choice is no longer available.' },
      ]);
    });
    it("accepts an unlisted value with allowOther", () => {
      expect(errorsFor({ ...radio, data: { ...radio.data, allowOther: true } }, "Green")).toEqual([]);
    });
    it("accepts exactly 200 characters of Other text and rejects 201", () => {
      const other = { ...radio, data: { ...radio.data, allowOther: true } };
      expect(errorsFor(other, "x".repeat(200))).toEqual([]);
      expect(errorsFor(other, "x".repeat(201))).toHaveLength(1);
    });
    it("treats blank as empty", () => {
      expect(errorsFor(radio, "")).toEqual([]);
    });
  });

  it("rejects a non-string answer for a single-string type", () => {
    for (const type of ["radio", "scale", "date", "number", "email"] as const) {
      expect(errorsFor(typed(type, { options: ["a"] }), ["a"])).toHaveLength(1);
    }
  });

  it("ignores other question types", () => {
    expect(errorsFor(typed("text"), "anything at all")).toEqual([]);
    expect(errorsFor(typed("select", { options: ["a"] }), "not listed")).toEqual([]);
  });

  it("reports every bad question, in order", () => {
    const questions: Question[] = [
      { ...typed("email"), key: "a" },
      { ...typed("scale"), key: "b" },
      { ...typed("date"), key: "c" },
    ];
    const errors = validateAnswerFormats(questions, { a: "nope", b: "9", c: "2026-11-02" });
    expect(errors.map((e) => e.key)).toEqual(["a", "b"]);
  });

  it("does not modify the answers", () => {
    const answers = { k: "  Ada@Example.edu " };
    validateAnswerFormats([typed("email")], answers);
    expect(answers).toEqual({ k: "  Ada@Example.edu " });
  });
});

describe("normalizeAnswerFormats", () => {
  it("trims and lowercases email", () => {
    const answers: Record<string, unknown> = { k: "  Ada@Example.EDU " };
    normalizeAnswerFormats([typed("email")], answers);
    expect(answers.k).toBe("ada@example.edu");
  });
  it("trims number, date and scale", () => {
    const answers: Record<string, unknown> = { n: " 4 ", d: " 2026-11-02 ", s: " 3 " };
    normalizeAnswerFormats(
      [{ ...typed("number"), key: "n" }, { ...typed("date"), key: "d" }, { ...typed("scale"), key: "s" }],
      answers,
    );
    expect(answers).toEqual({ n: "4", d: "2026-11-02", s: "3" });
  });
  it("leaves radio write-ins and text answers literal", () => {
    const answers: Record<string, unknown> = { r: " Other  Thing ", t: "  Hi " };
    normalizeAnswerFormats(
      [{ ...typed("radio", { allowOther: true }), key: "r" }, { ...typed("text"), key: "t" }],
      answers,
    );
    expect(answers).toEqual({ r: " Other  Thing ", t: "  Hi " });
  });
  it("skips missing and non-string answers", () => {
    const answers: Record<string, unknown> = { k: 5 };
    normalizeAnswerFormats([typed("email"), { ...typed("email"), key: "gone" }], answers);
    expect(answers).toEqual({ k: 5 });
  });
});

describe("isValidIsoDate", () => {
  it("handles leap days and century rules", () => {
    expect(isValidIsoDate("2000-02-29")).toBe(true);
    expect(isValidIsoDate("1900-02-29")).toBe(false);
  });
});

describe("isValidOtherText", () => {
  it("rejects blank and over-length, accepts the boundary", () => {
    expect(isValidOtherText("")).toBe(false);
    expect(isValidOtherText("   ")).toBe(false);
    expect(isValidOtherText("a")).toBe(true);
    expect(isValidOtherText("a".repeat(200))).toBe(true);
    expect(isValidOtherText("a".repeat(201))).toBe(false);
  });
});

describe("question types in required handling", () => {
  it.each(["radio", "scale", "date", "number", "email"] as const)(
    "a required %s is missing until it has a value",
    (type) => {
      const question: Question = { ...typed(type), required: true };
      expect(findMissingRequired([question], () => "")).toHaveLength(1);
      expect(findMissingRequired([question], () => "  ")).toHaveLength(1);
      expect(findMissingRequired([question], () => "1")).toHaveLength(0);
    },
  );
});

describe("hasNothingToPick", () => {
  const ref = (referenceOptions?: { value: string; label: string }[]) =>
    q({ key: "p", type: "reference", required: true, data: { label: "Project", referenceOptions } });

  it("is true only for a Database list whose choices resolved to nothing", () => {
    expect(hasNothingToPick(ref([]))).toBe(true);
    expect(hasNothingToPick(ref([{ value: "a", label: "A" }]))).toBe(false);
    expect(hasNothingToPick(ref(undefined))).toBe(false);
    expect(hasNothingToPick(q({ key: "t", type: "text", data: { label: "T", referenceOptions: [] } }))).toBe(false);
  });

  it("keeps an empty list out of the missing answers, but not an unresolved one", () => {
    expect(findMissingRequired([ref([])], () => undefined)).toEqual([]);
    expect(findMissingRequired([ref(undefined)], () => undefined)).toHaveLength(1);
  });
});

describe("file answers", () => {
  const KEY_A = "uploads/applications/shots/0b6f8a52-1c1e-4d38-9a51-2f3c6d7e8f90-home screen.png";
  const KEY_B = "uploads/applications/shots/7d1e2f3a-4b5c-4d6e-8f70-112233445566-b.png";
  const fileQ = (data: Partial<Question["data"]> = {}): Question => ({
    key: "shots",
    type: "file",
    required: true,
    data: { label: "Screenshots", ...data },
  });

  it("reads a single key, a stored array and a fill-state JSON array", () => {
    expect(parseFileAnswer(KEY_A)).toEqual([KEY_A]);
    expect(parseFileAnswer([KEY_A, KEY_B])).toEqual([KEY_A, KEY_B]);
    expect(parseFileAnswer(JSON.stringify([KEY_A, KEY_B]))).toEqual([KEY_A, KEY_B]);
  });

  it("reads blanks, bad JSON and other shapes as no files", () => {
    for (const raw of [undefined, null, "", "  ", "[", "[]", {}, 3, [1, ""]]) {
      expect(parseFileAnswer(raw)).toEqual([]);
    }
  });

  it("writes a plain key for one-file questions and a JSON array for more", () => {
    expect(serializeFileAnswer([KEY_A], 1)).toBe(KEY_A);
    expect(serializeFileAnswer([KEY_A, KEY_B], 3)).toBe(JSON.stringify([KEY_A, KEY_B]));
    expect(serializeFileAnswer([], 3)).toBe("");
  });

  it("defaults to one file and caps at the per-question limit", () => {
    expect(maxFilesFor(fileQ())).toBe(1);
    expect(maxFilesFor(fileQ({ maxFiles: 3 }))).toBe(3);
    expect(maxFilesFor(fileQ({ maxFiles: 0 }))).toBe(1);
    expect(maxFilesFor(fileQ({ maxFiles: 2.5 }))).toBe(1);
    expect(maxFilesFor(fileQ({ maxFiles: 50 }))).toBe(MAX_FILES_PER_QUESTION);
  });

  it("names a file without its upload id", () => {
    expect(fileAnswerName(KEY_A)).toBe("home screen.png");
    expect(fileAnswerName("uploads/applications/shots/plain.png")).toBe("plain.png");
  });

  it("counts a file question as answered only with an upload", () => {
    expect(isAnswered("", fileQ())).toBe(false);
    expect(isAnswered("[]", fileQ())).toBe(false);
    expect(isAnswered(KEY_A, fileQ())).toBe(true);
    expect(isAnswered(JSON.stringify([KEY_A]), fileQ())).toBe(true);
  });
});

describe("fileCountError", () => {
  const fq = (data: Partial<Question["data"]>): Question => ({
    key: "shots",
    type: "file",
    required: true,
    data: { label: "Shots", ...data },
  });

  it("allows 1 to N for up to N", () => {
    const q = fq({ maxFiles: 3 });
    expect([1, 2, 3].map((n) => fileCountError(q, n))).toEqual([null, null, null]);
    expect(fileCountError(q, 4)).toBe("takes up to 3 files.");
    expect(fileCountError(fq({}), 2)).toBe("takes one file.");
  });

  it("allows only N for exactly N", () => {
    const q = fq({ maxFiles: 3, exactFiles: true });
    expect(fileCountError(q, 3)).toBeNull();
    expect(fileCountError(q, 1)).toBe("add exactly 3 files.");
    expect(fileCountError(q, 4)).toBe("add exactly 3 files.");
  });

  it("leaves zero files to the required check", () => {
    expect(fileCountError(fq({ maxFiles: 3, exactFiles: true }), 0)).toBeNull();
  });

  it("reports the count through validateAnswerFormats", () => {
    const q = fq({ maxFiles: 3, exactFiles: true });
    expect(validateAnswerFormats([q], { shots: JSON.stringify(["a", "b"]) })).toEqual([
      { key: "shots", message: '"Shots": add exactly 3 files.' },
    ]);
    expect(validateAnswerFormats([q], { shots: ["a", "b", "c"] })).toEqual([]);
    expect(validateAnswerFormats([q], { shots: "" })).toEqual([]);
  });
});
