import { describe, expect, it } from "vitest";
import {
  gradeQuestion,
  gradeQuiz,
  isOpenResponse,
  keepCorrectAnswers,
  normalizeAnswer,
} from "../quiz";
import type { MultipleChoiceQuestion, Quiz, ShortAnswerQuestion } from "../types";

const mc: MultipleChoiceQuestion = {
  id: "mc",
  type: "multiple-choice",
  prompt: "Pick b",
  options: [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
  ],
  correctOptionId: "b",
};
const short = (acceptedAnswers: string[]): ShortAnswerQuestion => ({
  id: "sa",
  type: "short-answer",
  prompt: "Name it",
  acceptedAnswers,
});
const quiz = (questions: Quiz["questions"], passingScore = 50): Quiz => ({ title: "Q", intro: "", passingScore, questions });

describe("normalizeAnswer", () => {
  it("lowercases and trims", () => expect(normalizeAnswer("  FlexBox ")).toBe("flexbox"));
  it("collapses inner whitespace", () => expect(normalizeAnswer("css \t  grid\n layout")).toBe("css grid layout"));
  it("drops trailing sentence punctuation", () => {
    expect(normalizeAnswer("flexbox.")).toBe("flexbox");
    expect(normalizeAnswer("flexbox?!")).toBe("flexbox");
  });
  it("keeps punctuation that isn't at the end", () => expect(normalizeAnswer("a.b")).toBe("a.b"));
  it("keeps other trailing characters", () => expect(normalizeAnswer("x,")).toBe("x,"));
});

describe("isOpenResponse", () => {
  it("is true for a short answer with no non-empty accepted answers", () => {
    expect(isOpenResponse(short([]))).toBe(true);
    expect(isOpenResponse(short(["", "  "]))).toBe(true);
  });
  it("is false once any accepted answer has text", () => expect(isOpenResponse(short(["", "flex"]))).toBe(false));
  it("is false for multiple choice", () => expect(isOpenResponse(mc)).toBe(false));
});

describe("gradeQuestion", () => {
  it("fails a blank or missing answer, even for open responses", () => {
    expect(gradeQuestion(mc)).toBe(false);
    expect(gradeQuestion(mc, "   ")).toBe(false);
    expect(gradeQuestion(short([]), "")).toBe(false);
  });
  it("matches multiple choice by option id", () => {
    expect(gradeQuestion(mc, "b")).toBe(true);
    expect(gradeQuestion(mc, "a")).toBe(false);
    expect(gradeQuestion(mc, "B")).toBe(false);
  });
  it("accepts any response to an open question", () => expect(gradeQuestion(short([""]), "anything")).toBe(true));
  it("matches short answers after normalizing both sides", () => {
    const q = short([" Flex Box. "]);
    expect(gradeQuestion(q, "flex   box")).toBe(true);
    expect(gradeQuestion(q, "FLEX BOX!")).toBe(true);
    expect(gradeQuestion(q, "grid")).toBe(false);
  });
  it("accepts any of several answers and ignores blank entries", () => {
    const q = short(["", "padding", "margin"]);
    expect(gradeQuestion(q, "Margin")).toBe(true);
    expect(gradeQuestion(q, "gap")).toBe(false);
  });
});

describe("gradeQuiz", () => {
  it("grades each question and totals the result", () => {
    const r = gradeQuiz(quiz([mc, short(["flex"])]), { mc: "b", sa: "grid" });
    expect(r.results).toEqual({ mc: true, sa: false });
    expect(r).toMatchObject({ correct: 1, total: 2, percent: 50 });
  });
  it("passes exactly at the threshold", () => {
    expect(gradeQuiz(quiz([mc, short(["flex"])], 50), { mc: "b" }).passed).toBe(true);
  });
  it("fails just under the threshold", () => {
    expect(gradeQuiz(quiz([mc, short(["flex"])], 51), { mc: "b" }).passed).toBe(false);
  });
  it("rounds the percent", () => {
    const three = quiz([mc, { ...mc, id: "m2" }, { ...mc, id: "m3" }], 67);
    const r = gradeQuiz(three, { mc: "b", m2: "b" });
    expect(r.percent).toBe(67);
    expect(r.passed).toBe(true);
  });
  it("never passes a quiz with no questions, even at a 0% bar", () => {
    const r = gradeQuiz(quiz([], 0), {});
    expect(r).toEqual({ results: {}, correct: 0, total: 0, percent: 0, passed: false });
  });
  it("passes a 0% bar with every answer wrong", () => {
    expect(gradeQuiz(quiz([mc], 0), { mc: "a" }).passed).toBe(true);
  });
  it("needs every question right at 100%", () => {
    expect(gradeQuiz(quiz([mc, short(["x"])], 100), { mc: "b", sa: "y" }).passed).toBe(false);
    expect(gradeQuiz(quiz([mc, short(["x"])], 100), { mc: "b", sa: "X" }).passed).toBe(true);
  });
  it("ignores answers to questions the quiz doesn't have", () => {
    expect(gradeQuiz(quiz([mc]), { mc: "b", other: "x" }).results).toEqual({ mc: true });
  });
});

describe("keepCorrectAnswers", () => {
  it("keeps only answers marked correct", () => {
    const answers = { mc: "b", sa: "grid" };
    const r = gradeQuiz(quiz([mc, short(["flex"])]), answers);
    expect(keepCorrectAnswers(answers, r)).toEqual({ mc: "b" });
  });
  it("drops answers with no result at all", () => {
    const r = gradeQuiz(quiz([mc]), { mc: "b" });
    expect(keepCorrectAnswers({ mc: "b", stray: "x" }, r)).toEqual({ mc: "b" });
  });
  it("does not mutate its input", () => {
    const answers = { mc: "a" };
    keepCorrectAnswers(answers, gradeQuiz(quiz([mc]), answers));
    expect(answers).toEqual({ mc: "a" });
  });
});
