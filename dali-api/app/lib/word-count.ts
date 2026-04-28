import type { Question } from "~/types";

export function countWords(value: string | undefined | null): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export type WordCountViolation = {
  wordCount: number;
  maxWords: number;
  label: string;
};

export function validateWordLimits(
  questions: Question[],
  answers: Record<string, string>,
): Record<string, WordCountViolation> {
  const violations: Record<string, WordCountViolation> = {};
  for (const q of questions) {
    if (q.type !== "textarea") continue;
    const maxWords = q.data.maxWords;
    if (maxWords === undefined) continue;
    const wordCount = countWords(answers[q.key]);
    if (wordCount > maxWords) {
      violations[q.key] = {
        wordCount,
        maxWords,
        label: q.data.label,
      };
    }
  }
  return violations;
}
