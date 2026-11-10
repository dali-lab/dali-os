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
// A Database list whose choices resolved to nothing can never be answered, so
// it never blocks submitting. Unresolved lists (no referenceOptions) still count.
export function hasNothingToPick(q: Question): boolean {
  return q.type === "reference" && Array.isArray(q.data.referenceOptions) && q.data.referenceOptions.length === 0;
}

export function findMissingRequired(
  questions: Question[],
  getValue: (q: Question) => string | undefined,
  opts?: { excludeFileType?: boolean },
): Question[] {
  return questions.filter(
    (q) =>
      !isLayoutOnly(q.type) &&
      q.required &&
      !hasNothingToPick(q) &&
      !(opts?.excludeFileType && q.type === "file") &&
      !isAnswered(getValue(q), q),
  );
}

export const OTHER_ANSWER_MAX_LENGTH = 200;

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const m = DATE_PATTERN.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

// Whether an Other write-in is acceptable: non-blank and within the cap.
export function isValidOtherText(value: string): boolean {
  return value.trim() !== "" && value.length <= OTHER_ANSWER_MAX_LENGTH;
}

export type AnswerFormatError = { key: string; message: string };

// Format checks for the single-string question types (radio, scale, date,
// number, email). Pure: it reads answers and never changes them. A missing or
// blank answer passes (required-ness is checked separately), and a question
// that already exists is always checked, whatever the flag says.
export function validateAnswerFormats(
  questions: Question[],
  answers: Record<string, unknown>,
): AnswerFormatError[] {
  const errors: AnswerFormatError[] = [];
  for (const q of questions) {
    const raw = answers[q.key];
    if (raw == null || raw === "") continue;
    const fail = (message: string) =>
      errors.push({ key: q.key, message: `"${q.data.label}": ${message}` });
    if (typeof raw !== "string") {
      if (["radio", "scale", "date", "number", "email"].includes(q.type)) {
        fail("couldn't read the answer.");
      }
      continue;
    }
    const value = raw.trim();
    if (value === "") continue;

    if (q.type === "scale" && !/^[1-5]$/.test(value)) {
      fail("pick a number from 1 to 5.");
    } else if (q.type === "date" && !isValidIsoDate(value)) {
      fail("enter a valid date.");
    } else if (q.type === "email" && !EMAIL_PATTERN.test(value)) {
      fail("enter a valid email address.");
    } else if (q.type === "number") {
      if (!NUMBER_PATTERN.test(value)) {
        fail("enter a number.");
        continue;
      }
      const n = Number(value);
      const { min, max } = q.data;
      if (min !== undefined && n < min) fail(`must be at least ${min}.`);
      else if (max !== undefined && n > max) fail(`must be at most ${max}.`);
    } else if (q.type === "radio") {
      if ((q.data.options ?? []).includes(raw)) continue;
      if (!q.data.allowOther) fail("that choice is no longer available.");
      else if (!isValidOtherText(raw)) {
        fail(`a write-in answer can't be blank or over ${OTHER_ANSWER_MAX_LENGTH} characters.`);
      }
    }
  }
  return errors;
}

// Trims the number and lowercases the email, in place, so every fill path
// stores the same shape. Call after validateAnswerFormats passes.
export function normalizeAnswerFormats(
  questions: Question[],
  answers: Record<string, unknown>,
): void {
  for (const q of questions) {
    const raw = answers[q.key];
    if (typeof raw !== "string") continue;
    if (q.type === "email") answers[q.key] = raw.trim().toLowerCase();
    else if (q.type === "number" || q.type === "date" || q.type === "scale") {
      answers[q.key] = raw.trim();
    }
  }
}
