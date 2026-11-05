import type { Question } from "~/types";
import { isAnswered, isLayoutOnly } from "~/lib/form-answers";
import { paginateQuestions, type FormPage } from "~/lib/form-pages";

export type ShowIf = NonNullable<Question["data"]["showIf"]>;
export type ShowIfOp = ShowIf["op"];

export const SCALE_VALUES = ["1", "2", "3", "4", "5"];

const OPS_BY_SOURCE_TYPE: Partial<Record<Question["type"], ShowIfOp[]>> = {
  select: ["is", "isNot"],
  radio: ["is", "isNot"],
  scale: ["is", "isNot"],
  checkbox: ["includes", "excludes"],
};

export const OP_LABELS: Record<ShowIfOp, string> = {
  is: "is",
  isNot: "is not",
  includes: "includes",
  excludes: "doesn't include",
};

export function canBeSource(q: Question): boolean {
  return q.type in OPS_BY_SOURCE_TYPE;
}

export function opsForSource(q: Question): ShowIfOp[] {
  return OPS_BY_SOURCE_TYPE[q.type] ?? [];
}

// The values a rule can name. Scale has no options of its own; an Other
// write-in is never a value a rule can name. Nor is an option with a {{token}}:
// stored answers hold the filled-in text, so the rule could never match it.
export function valuesForSource(q: Question): string[] {
  if (q.type === "scale") return SCALE_VALUES;
  if (!canBeSource(q)) return [];
  return (q.data.options ?? []).filter((option) => !option.includes("{{"));
}

export function hasRules(questions: Question[]): boolean {
  return questions.some((q) => q.data.showIf);
}

// The number shown beside a question (Q1, Q2...): layout blocks are skipped.
export function questionNumbers(questions: Question[]): Map<string, number> {
  const numbers = new Map<string, number>();
  let n = 0;
  for (const q of questions) {
    if (isLayoutOnly(q.type)) continue;
    numbers.set(q.key, ++n);
  }
  return numbers;
}

function checkboxValues(raw: unknown): string[] | null {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "") return null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const values = parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  return values.length > 0 ? values : null;
}

function singleValue(raw: unknown): string | null {
  if (typeof raw === "number") return String(raw);
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text === "" ? null : text;
}

function conditionHolds(rule: ShowIf, source: Question, raw: unknown): boolean {
  if (source.type === "checkbox") {
    const values = checkboxValues(raw);
    if (!values) return false;
    if (rule.op === "includes") return values.includes(rule.value);
    if (rule.op === "excludes") return !values.includes(rule.value);
    return false;
  }
  const value = singleValue(raw);
  if (value === null) return false;
  if (rule.op === "is") return value === rule.value;
  if (rule.op === "isNot") return value !== rule.value;
  return false;
}

// Walks the form in order. A rule can only look at an earlier question, so one
// pass settles everything: a hidden source counts as unanswered, and a rule on
// a source that comes later or doesn't exist hides its question.
export function visibleKeys(
  questions: Question[],
  answers: Record<string, unknown>,
): Set<string> {
  const visible = new Set<string>();
  const byKey = new Map<string, Question>();
  for (const q of questions) {
    const rule = q.data.showIf;
    let shown = true;
    if (rule && q.type !== "pageBreak") {
      const source = byKey.get(rule.questionKey);
      shown =
        !!source &&
        visible.has(source.key) &&
        conditionHolds(rule, source, answers[source.key]);
    }
    if (shown) visible.add(q.key);
    byKey.set(q.key, q);
  }
  return visible;
}

export function visibleQuestions(
  questions: Question[],
  answers: Record<string, unknown>,
): Question[] {
  if (!hasRules(questions)) return questions;
  const visible = visibleKeys(questions, answers);
  return questions.filter((q) => visible.has(q.key));
}

// Paginates first, then filters each page, and drops only the pages the rules
// emptied. A page that was empty to begin with stays, as it does without rules.
export function visiblePages(
  questions: Question[],
  answers: Record<string, unknown>,
): FormPage[] {
  const pages = paginateQuestions(questions);
  if (!hasRules(questions)) return pages;
  const visible = visibleKeys(questions, answers);
  const kept: FormPage[] = [];
  for (const page of pages) {
    const shown = page.questions.filter((q) => visible.has(q.key));
    if (shown.length === 0 && page.questions.length > 0) continue;
    kept.push({ ...page, questions: shown });
  }
  return kept.length > 0 ? kept : [{ ...pages[0], questions: [] }];
}

export function hiddenQuestionKeys(
  questions: Question[],
  answers: Record<string, unknown>,
): string[] {
  if (!hasRules(questions)) return [];
  const visible = visibleKeys(questions, answers);
  return questions.filter((q) => !visible.has(q.key)).map((q) => q.key);
}

export function pruneHiddenAnswers<T>(
  questions: Question[],
  answers: Record<string, T>,
): Record<string, T> {
  const hidden = new Set(hiddenQuestionKeys(questions, answers));
  if (hidden.size === 0) return answers;
  return Object.fromEntries(Object.entries(answers).filter(([key]) => !hidden.has(key)));
}

// In-place twin of pruneHiddenAnswers for the submit paths that normalize the
// posted answers object. Returns the questions that stay visible.
export function dropHiddenAnswers(
  questions: Question[],
  answers: Record<string, unknown>,
): Question[] {
  const hidden = new Set(hiddenQuestionKeys(questions, answers));
  if (hidden.size === 0) return questions;
  for (const key of hidden) delete answers[key];
  return questions.filter((q) => !hidden.has(q.key));
}

// Required questions among `questions` (pass the visible ones) and how many
// of them are answered, for progress counts.
export function countRequired(
  questions: Question[],
  answers: Record<string, string> | undefined,
): { required: number; answered: number } {
  const required = questions.filter((q) => q.required);
  return {
    required: required.length,
    answered: required.filter((q) => isAnswered(answers?.[q.key], q)).length,
  };
}

export type ShowIfProblem = { key: string; message: string };

function nameOf(q: Question): string {
  const label = q.data.label?.trim();
  if (label) return `"${label}"`;
  return q.type === "pageBreak" ? "A page break" : "An untitled question";
}

// Everything that makes a rule unusable. `mapped` names, per question key, the
// feature that reads that answer, so a mapped question can't be conditional.
export function showIfProblems(
  questions: Question[],
  mapped?: ReadonlyMap<string, string>,
): ShowIfProblem[] {
  const problems: ShowIfProblem[] = [];
  const indexByKey = new Map(questions.map((q, i) => [q.key, i]));
  questions.forEach((q, index) => {
    const rule = q.data.showIf;
    if (!rule) return;
    const fail = (message: string) => problems.push({ key: q.key, message });
    if (q.type === "pageBreak") {
      return fail("A page break can't have a condition.");
    }
    const feature = mapped?.get(q.key);
    if (feature) {
      return fail(`${nameOf(q)} is used by ${feature} and always has to be shown.`);
    }
    const sourceIndex = indexByKey.get(rule.questionKey);
    if (sourceIndex === undefined) {
      return fail(`${nameOf(q)} depends on a question that was deleted.`);
    }
    const source = questions[sourceIndex];
    if (sourceIndex >= index) {
      return fail(`${nameOf(q)} depends on ${nameOf(source)}, which now comes after it.`);
    }
    if (!canBeSource(source)) {
      return fail(`${nameOf(q)} depends on ${nameOf(source)}, which can't be used in a condition.`);
    }
    if (!opsForSource(source).includes(rule.op)) {
      return fail(`${nameOf(q)} has a condition that doesn't fit ${nameOf(source)}.`);
    }
    if (!valuesForSource(source).includes(rule.value)) {
      return fail(
        `${nameOf(q)} depends on "${rule.value}", which is no longer an option of ${nameOf(source)}.`,
      );
    }
  });
  return problems;
}

// "Q2 is No", used under a conditional question.
export function showIfSentence(
  rule: ShowIf,
  numbers: ReadonlyMap<string, number>,
): string {
  const n = numbers.get(rule.questionKey);
  return `${n ? `Q${n}` : "A deleted question"} ${OP_LABELS[rule.op]} ${rule.value}`;
}

// "who picked Design in Q4", for the line under a conditional summary.
export function audienceSentence(
  rule: ShowIf,
  numbers: ReadonlyMap<string, number>,
): string {
  const n = numbers.get(rule.questionKey);
  const where = n ? `Q${n}` : "an earlier question";
  const negative = rule.op === "isNot" || rule.op === "excludes";
  return `who ${negative ? "didn't pick" : "picked"} ${rule.value} in ${where}`;
}

// How deep a question sits under the ones it depends on (0 when unconditional).
// Rules that don't resolve count as depth 0.
export function ruleDepths(questions: Question[]): Map<string, number> {
  const depths = new Map<string, number>();
  for (const q of questions) {
    const source = q.data.showIf && depths.has(q.data.showIf.questionKey)
      ? depths.get(q.data.showIf.questionKey)!
      : null;
    depths.set(q.key, source === null ? 0 : source + 1);
  }
  return depths;
}
