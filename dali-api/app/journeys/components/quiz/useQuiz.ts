import { useCallback, useState } from "react";
import type { Quiz } from "~/journeys/lib/types";
import { gradeQuiz, keepCorrectAnswers, type QuizAnswers, type QuizResult } from "~/journeys/lib/quiz";

/** Learner-side quiz state: answers, grading, and retrying only the missed questions. */
export function useQuiz(quiz: Quiz) {
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [attempts, setAttempts] = useState(0);

  const answered = quiz.questions.filter((q) => answers[q.id]?.trim()).length;
  const canSubmit = quiz.questions.length > 0 && answered === quiz.questions.length;

  const setAnswer = useCallback((questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  const submit = useCallback((): QuizResult => {
    const graded = gradeQuiz(quiz, answers);
    setResult(graded);
    setAttempts((n) => n + 1);
    return graded;
  }, [quiz, answers]);

  const retry = useCallback(() => {
    if (!result) return;
    setAnswers((prev) => keepCorrectAnswers(prev, result));
    setResult(null);
  }, [result]);

  return { answers, result, attempts, answered, canSubmit, setAnswer, submit, retry };
}
