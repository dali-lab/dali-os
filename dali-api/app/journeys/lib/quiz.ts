import type { Quiz, QuizQuestion } from "./types";

/** Learner answers keyed by question id. Multiple choice stores the option id. */
export type QuizAnswers = Record<string, string>;

export interface QuizResult {
  results: Record<string, boolean>;
  correct: number;
  total: number;
  percent: number;
  passed: boolean;
}

export function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
}

export function isOpenResponse(question: QuizQuestion): boolean {
  return question.type === "short-answer" && question.acceptedAnswers.every((a) => !a.trim());
}

export function gradeQuestion(question: QuizQuestion, answer = ""): boolean {
  if (!answer.trim()) return false;
  if (question.type === "multiple-choice") return answer === question.correctOptionId;
  if (isOpenResponse(question)) return true;
  const given = normalizeAnswer(answer);
  return question.acceptedAnswers.some((a) => a.trim() && normalizeAnswer(a) === given);
}

export function gradeQuiz(quiz: Quiz, answers: QuizAnswers): QuizResult {
  const results: Record<string, boolean> = {};
  for (const q of quiz.questions) results[q.id] = gradeQuestion(q, answers[q.id]);
  const total = quiz.questions.length;
  const correct = Object.values(results).filter(Boolean).length;
  const percent = total ? Math.round((correct / total) * 100) : 0;
  return { results, correct, total, percent, passed: total > 0 && percent >= quiz.passingScore };
}

/** The answers worth keeping for a retry: only the ones that were right. */
export function keepCorrectAnswers(answers: QuizAnswers, result: QuizResult): QuizAnswers {
  return Object.fromEntries(Object.entries(answers).filter(([id]) => result.results[id]));
}
