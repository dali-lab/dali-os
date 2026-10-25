// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { renderHook } from "~/components/drive/__tests__/render-hook";
import type { Quiz } from "~/journeys/lib/types";
import { useQuiz } from "../useQuiz";

const quiz: Quiz = {
  title: "Q",
  intro: "",
  passingScore: 100,
  questions: [
    {
      id: "mc",
      type: "multiple-choice",
      prompt: "Pick b",
      options: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      correctOptionId: "b",
    },
    { id: "sa", type: "short-answer", prompt: "Name it", acceptedAnswers: ["flex"] },
  ],
};

const unmounts: Array<() => void> = [];
afterEach(() => unmounts.splice(0).forEach((u) => u()));

function mount(q: Quiz = quiz) {
  const r = renderHook(useQuiz, { initialProps: q });
  unmounts.push(r.unmount);
  return r.result;
}

describe("useQuiz", () => {
  it("starts empty and not submittable", () => {
    const result = mount();
    expect(result.current).toMatchObject({ answers: {}, result: null, attempts: 0, answered: 0, canSubmit: false });
  });

  it("can submit only once every question has a non-blank answer", () => {
    const result = mount();
    act(() => result.current.setAnswer("mc", "a"));
    expect(result.current.answered).toBe(1);
    expect(result.current.canSubmit).toBe(false);
    act(() => result.current.setAnswer("sa", "   "));
    expect(result.current.answered).toBe(1);
    expect(result.current.canSubmit).toBe(false);
    act(() => result.current.setAnswer("sa", "flex"));
    expect(result.current.canSubmit).toBe(true);
  });

  it("never allows submitting a quiz with no questions", () => {
    const result = mount({ ...quiz, questions: [] });
    expect(result.current.canSubmit).toBe(false);
  });

  it("grades on submit, returns the result and counts attempts", () => {
    const result = mount();
    act(() => {
      result.current.setAnswer("mc", "b");
      result.current.setAnswer("sa", "grid");
    });
    let graded: ReturnType<typeof result.current.submit> | undefined;
    act(() => {
      graded = result.current.submit();
    });
    expect(graded).toMatchObject({ correct: 1, total: 2, passed: false });
    expect(result.current.result).toEqual(graded);
    expect(result.current.attempts).toBe(1);
  });

  it("retry keeps only the correct answers and clears the result", () => {
    const result = mount();
    act(() => {
      result.current.setAnswer("mc", "b");
      result.current.setAnswer("sa", "grid");
    });
    act(() => void result.current.submit());
    act(() => result.current.retry());
    expect(result.current.result).toBeNull();
    expect(result.current.answers).toEqual({ mc: "b" });
    expect(result.current.attempts).toBe(1);

    act(() => result.current.setAnswer("sa", "Flex."));
    act(() => void result.current.submit());
    expect(result.current.result?.passed).toBe(true);
    expect(result.current.attempts).toBe(2);
  });

  it("retry does nothing before a submit", () => {
    const result = mount();
    act(() => result.current.setAnswer("mc", "a"));
    act(() => result.current.retry());
    expect(result.current.answers).toEqual({ mc: "a" });
  });
});
