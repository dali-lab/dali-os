import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db");

import { validateAnswers } from "~/forms/lib/public-form";
import type { Question } from "~/types";

function checkboxQ(partial: Partial<Question> = {}): Question {
  return {
    key: "picks",
    type: "checkbox",
    required: false,
    data: { label: "Workshops", options: ["A", "B", "C"] },
    ...partial,
  } as Question;
}

describe("validateAnswers checkbox normalization", () => {
  it("parses a JSON-stringified selection and stores a real array in place", async () => {
    const answers: Record<string, unknown> = { picks: '["A","B"]' };
    const result = await validateAnswers([checkboxQ()], answers, "user-1");
    expect(result).toBeNull();
    expect(answers.picks).toEqual(["A", "B"]);
  });

  it("accepts an already-parsed array and dedupes it", async () => {
    const answers: Record<string, unknown> = { picks: ["A", "A", "C"] };
    const result = await validateAnswers([checkboxQ()], answers, "user-1");
    expect(result).toBeNull();
    expect(answers.picks).toEqual(["A", "C"]);
  });

  it("rejects an option that isn't in the question", async () => {
    const result = await validateAnswers(
      [checkboxQ()],
      { picks: '["Z"]' },
      "user-1",
    );
    expect(result).toMatchObject({ status: 400 });
    expect(result?.error).toContain("no longer available");
  });

  it("rejects malformed JSON", async () => {
    const result = await validateAnswers(
      [checkboxQ()],
      { picks: "[oops" },
      "user-1",
    );
    expect(result).toMatchObject({ status: 400 });
    expect(result?.error).toContain("couldn't read");
  });

  it("rejects non-string elements", async () => {
    const result = await validateAnswers(
      [checkboxQ()],
      { picks: "[1]" },
      "user-1",
    );
    expect(result).toMatchObject({ status: 400 });
  });

  it("treats '' and '[]' as unanswered for a required question", async () => {
    const q = checkboxQ({ required: true });
    const empty = await validateAnswers([q], { picks: "" }, "user-1");
    expect(empty).toMatchObject({ status: 400 });
    expect(empty?.error).toContain("required");

    // '[]' must normalize BEFORE the required pass so it's caught as empty.
    const emptyArray = await validateAnswers([q], { picks: "[]" }, "user-1");
    expect(emptyArray).toMatchObject({ status: 400 });
    expect(emptyArray?.error).toContain("required");
  });

  it("allows an optional checkbox to be skipped", async () => {
    expect(await validateAnswers([checkboxQ()], {}, "user-1")).toBeNull();
  });
});
