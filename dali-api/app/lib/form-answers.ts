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
  if (question?.type === "file") return parseFileAnswer(value).length > 0;
  if (question?.type === "skills_rating") {
    return isSkillsRatingComplete(value, question.data.options ?? []);
  }
  return typeof value === "string" && value.trim() !== "";
}

// A Database list whose choices resolved to nothing can never be answered, so
// it never blocks submitting. Unresolved lists (no referenceOptions) still count.
export function hasNothingToPick(q: Question): boolean {
  return q.type === "reference" && Array.isArray(q.data.referenceOptions) && q.data.referenceOptions.length === 0;
}

export function findMissingRequired(
  questions: Question[],
  getValue: (q: Question) => string | undefined,
): Question[] {
  return questions.filter(
    (q) =>
      !isLayoutOnly(q.type) &&
      q.required &&
      !hasNothingToPick(q) &&
      !isAnswered(getValue(q), q),
  );
}

export const OTHER_ANSWER_MAX_LENGTH = 200;

export const MAX_FILES_PER_QUESTION = 10;

export function maxFilesFor(q: Question): number {
  const n = q.data.maxFiles;
  return typeof n === "number" && Number.isInteger(n) && n >= 1
    ? Math.min(n, MAX_FILES_PER_QUESTION)
    : 1;
}

// A file answer is one upload key, a string[] of keys, or (in fill state) that
// array JSON-stringified.
export function parseFileAnswer(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((k): k is string => typeof k === "string" && k !== "");
  if (typeof raw !== "string" || raw.trim() === "") return [];
  if (!raw.startsWith("[")) return [raw];
  try {
    return parseFileAnswer(JSON.parse(raw));
  } catch {
    return [];
  }
}

// Why `count` files doesn't fit the question, or null. Zero is left to the
// required check.
export function fileCountError(q: Question, count: number): string | null {
  const max = maxFilesFor(q);
  if (count === 0) return null;
  if (q.data.exactFiles && max > 1 && count !== max) return `add exactly ${max} files.`;
  if (count > max) return max === 1 ? "takes one file." : `takes up to ${max} files.`;
  return null;
}

export function serializeFileAnswer(keys: string[], maxFiles: number): string {
  if (keys.length === 0) return "";
  return maxFiles > 1 ? JSON.stringify(keys) : keys[0];
}

export function fileAnswerName(key: string): string {
  const last = key.split("/").pop() ?? key;
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "") || last;
}

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
    if (q.type === "file") {
      const countError = fileCountError(q, parseFileAnswer(raw).length);
      if (countError) fail(countError);
      continue;
    }
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
