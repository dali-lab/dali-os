import type { Question } from "~/types";
import { isSkillsRatingComplete } from "~/hiring/lib/skills-rating";

// Single source of truth for "is this question answered?". Preserves the
// skills-rating-aware behavior from portal.apply.tsx's external-applicant flow:
// a skills_rating answer counts as answered only when every skill is rated.
export function isAnswered(value: string | undefined, question?: Question): boolean {
  if (question?.type === "info") return true; // prose block, never an answer
  if (question?.type === "skills_rating") {
    return isSkillsRatingComplete(value, question.data.options ?? []);
  }
  return typeof value === "string" && value.trim() !== "";
}

// Required, unanswered questions in their original order. `info` is always
// excluded (it is never a real answer). `file` is optionally excluded for fill
// surfaces that can't upload (e.g. the member form-fill view).
export function findMissingRequired(
  questions: Question[],
  getValue: (q: Question) => string | undefined,
  opts?: { excludeFileType?: boolean },
): Question[] {
  return questions.filter(
    (q) =>
      q.type !== "info" &&
      q.required &&
      !(opts?.excludeFileType && q.type === "file") &&
      !isAnswered(getValue(q), q),
  );
}
