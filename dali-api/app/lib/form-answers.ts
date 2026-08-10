import type { Question } from "~/types";
import { isSkillsRatingComplete } from "~/lib/skills-rating";

// Layout-only blocks carry no answer and never gate submission: `info` prose
// blocks and `pageBreak` dividers. Every "is this a real question?" check
// routes through here so a new layout type is opted out in one place.
export function isLayoutOnly(type: Question["type"]): boolean {
  return type === "info" || type === "pageBreak";
}

// Single source of truth for "is this question answered?". Preserves the
// skills-rating-aware behavior from portal.apply.tsx's external-applicant flow:
// a skills_rating answer counts as answered only when every skill is rated.
export function isAnswered(value: string | undefined, question?: Question): boolean {
  if (question && isLayoutOnly(question.type)) return true; // not an answer
  if (question?.type === "skills_rating") {
    return isSkillsRatingComplete(value, question.data.options ?? []);
  }
  return typeof value === "string" && value.trim() !== "";
}

// Required, unanswered questions in their original order. Layout-only blocks
// (`info`, `pageBreak`) are always excluded (never a real answer). `file` is
// optionally excluded for fill surfaces that can't upload (e.g. the member
// form-fill view).
export function findMissingRequired(
  questions: Question[],
  getValue: (q: Question) => string | undefined,
  opts?: { excludeFileType?: boolean },
): Question[] {
  return questions.filter(
    (q) =>
      !isLayoutOnly(q.type) &&
      q.required &&
      !(opts?.excludeFileType && q.type === "file") &&
      !isAnswered(getValue(q), q),
  );
}
