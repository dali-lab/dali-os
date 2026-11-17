import type { Question, ShowIfOp, ShowIfRule } from "~/types";
import { isAnswered, isLayoutOnly, parseFileAnswer } from "~/forms/lib/form-answers";
import { paginateQuestions, type FormPage } from "~/forms/lib/form-pages";

export type ShowIf = ShowIfRule;
export type { ShowIfOp };
export type Condition = { questionKey: string; op: ShowIfOp; values: string[]; labels?: string[] };
export type Rule = { match: "all" | "any"; conditions: Condition[] };

export const SCALE_VALUES = ["1", "2", "3", "4", "5"];
export const OTHER_VALUE = "__other__";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

const PICK_OPS: ShowIfOp[] = ["is", "isNot"];
const PRESENCE_OPS: ShowIfOp[] = ["answered", "blank"];
const TEXT_OPS: ShowIfOp[] = ["contains", ...PRESENCE_OPS];
const RANGE_OPS: ShowIfOp[] = ["atLeast", "atMost", ...PRESENCE_OPS];

const OPS_BY_SOURCE_TYPE: Partial<Record<Question["type"], ShowIfOp[]>> = {
  select: [...PICK_OPS, ...PRESENCE_OPS],
  radio: [...PICK_OPS, ...PRESENCE_OPS],
  reference: [...PICK_OPS, ...PRESENCE_OPS],
  scale: [...PICK_OPS, ...RANGE_OPS],
  checkbox: ["includes", "excludes", ...PRESENCE_OPS],
  number: RANGE_OPS,
  date: RANGE_OPS,
  text: TEXT_OPS,
  textarea: TEXT_OPS,
  email: TEXT_OPS,
  github_url: TEXT_OPS,
  figma_url: TEXT_OPS,
  drive_url: TEXT_OPS,
  file: PRESENCE_OPS,
};

export const OP_LABELS: Record<ShowIfOp, string> = {
  is: "is",
  isNot: "is not",
  includes: "includes",
  excludes: "doesn't include",
  atLeast: "is at least",
  atMost: "is at most",
  contains: "contains",
  answered: "is answered",
  blank: "is blank",
};

export function opLabel(op: ShowIfOp, sourceType?: Question["type"]): string {
  if (sourceType === "date" && op === "atLeast") return "is on or after";
  if (sourceType === "date" && op === "atMost") return "is on or before";
  return OP_LABELS[op] ?? op;
}

export function canBeSource(q: Question): boolean {
  return q.type in OPS_BY_SOURCE_TYPE;
}

export function opsForSource(q: Question): ShowIfOp[] {
  return OPS_BY_SOURCE_TYPE[q.type] ?? [];
}

// How a condition's value is entered: several picks from a list, one pick, a
// typed number, date or text, or nothing at all.
export type ValueInput = "pick" | "pickOne" | "number" | "date" | "text" | "none";

export function valueInput(source: Pick<Question, "type">, op: ShowIfOp): ValueInput {
  switch (op) {
    case "answered":
    case "blank":
      return "none";
    case "contains":
      return "text";
    case "atLeast":
    case "atMost":
      return source.type === "scale" ? "pickOne" : source.type === "date" ? "date" : "number";
    default:
      return "pick";
  }
}

function hasTokenOption(q: Question): boolean {
  return (q.data.options ?? []).some((option) => option.includes("{{"));
}

// The values a rule can pick from. An option with a {{token}} is never one:
// stored answers hold the filled-in text, so the rule could never match it.
// For the same reason Other is only offered when no option has a token.
// Database lists only know their rows once the builder has loaded them.
export function valuesForSource(q: Question): string[] {
  if (q.type === "scale") return SCALE_VALUES;
  if (q.type === "reference") return (q.data.referenceOptions ?? []).map((o) => o.value);
  if (q.type !== "select" && q.type !== "radio" && q.type !== "checkbox") return [];
  const options = (q.data.options ?? []).filter((option) => !option.includes("{{"));
  return q.type !== "select" && q.data.allowOther && !hasTokenOption(q)
    ? [...options, OTHER_VALUE]
    : options;
}

export function valueLabel(source: Question | undefined, value: string, label?: string): string {
  if (value === OTHER_VALUE) return "Other";
  if (label) return label;
  return source?.data.referenceOptions?.find((o) => o.value === value)?.label ?? value;
}

export function defaultCondition(source: Question, op = opsForSource(source)[0]): Condition {
  const input = valueInput(source, op);
  const values =
    input === "pick" && source.type !== "reference" ? valuesForSource(source).slice(0, 1) : input === "pickOne" ? ["3"] : [];
  return { questionKey: source.key, op, values };
}

function conditionOf(raw: unknown): Condition {
  const c = (raw ?? {}) as Record<string, unknown>;
  const values = Array.isArray(c.values)
    ? c.values.filter((v): v is string => typeof v === "string")
    : typeof c.value === "string"
      ? [c.value]
      : [];
  const labels = Array.isArray(c.labels)
    ? c.labels.filter((v): v is string => typeof v === "string")
    : undefined;
  return {
    questionKey: typeof c.questionKey === "string" ? c.questionKey : "",
    op: c.op as ShowIfOp,
    values,
    ...(labels ? { labels } : {}),
  };
}

// Reads both stored shapes: a lone condition (every rule saved before rules
// could hold several) and { match, conditions }.
export function ruleOf(showIf: ShowIfRule | undefined | null): Rule | null {
  if (!showIf || typeof showIf !== "object") return null;
  if ("conditions" in showIf && Array.isArray(showIf.conditions)) {
    return {
      match: showIf.match === "any" ? "any" : "all",
      conditions: showIf.conditions.map(conditionOf),
    };
  }
  return { match: "all", conditions: [conditionOf(showIf)] };
}

export function toShowIf(rule: Rule): ShowIfRule {
  return {
    match: rule.match,
    conditions: rule.conditions.map((c) => ({
      questionKey: c.questionKey,
      op: c.op,
      values: c.values,
      ...(c.labels?.length ? { labels: c.labels } : {}),
    })),
  };
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

function hasAnswer(source: Question, raw: unknown): boolean {
  if (source.type === "checkbox") return checkboxValues(raw) !== null;
  if (source.type === "file") return parseFileAnswer(raw).length > 0;
  if (typeof raw === "string") return isAnswered(raw, source);
  if (typeof raw === "number") return Number.isFinite(raw);
  if (Array.isArray(raw)) return raw.length > 0;
  return raw !== null && typeof raw === "object";
}

function isOther(source: Question, value: string): boolean {
  return !!source.data.allowOther && !(source.data.options ?? []).includes(value);
}

function picks(source: Question, value: string, wanted: string): boolean {
  return wanted === OTHER_VALUE ? isOther(source, value) : value === wanted;
}

function compare(source: Question, value: string, bound: string): number | null {
  if (source.type === "date") {
    if (!DATE_PATTERN.test(value) || !DATE_PATTERN.test(bound)) return null;
    return value < bound ? -1 : value > bound ? 1 : 0;
  }
  const a = Number(value);
  const b = Number(bound);
  if (!NUMBER_PATTERN.test(value) || !NUMBER_PATTERN.test(bound)) return null;
  return a - b;
}

function conditionHolds(c: Condition, source: Question, raw: unknown): boolean {
  if (!opsForSource(source).includes(c.op)) return false;
  switch (c.op) {
    case "answered":
      return hasAnswer(source, raw);
    case "blank":
      return !hasAnswer(source, raw);
    case "includes":
    case "excludes": {
      const values = checkboxValues(raw);
      if (!values) return false;
      const match = c.values.some((wanted) => values.some((v) => picks(source, v, wanted)));
      return c.op === "includes" ? match : !match;
    }
    case "is":
    case "isNot": {
      const value = singleValue(raw);
      if (value === null) return false;
      const match = c.values.some((wanted) => picks(source, value, wanted));
      return c.op === "is" ? match : !match;
    }
    case "atLeast":
    case "atMost": {
      const value = singleValue(raw);
      const bound = c.values[0];
      if (value === null || bound === undefined) return false;
      const diff = compare(source, value, bound);
      if (diff === null) return false;
      return c.op === "atLeast" ? diff >= 0 : diff <= 0;
    }
    case "contains": {
      const needle = c.values[0]?.trim().toLowerCase();
      const value = typeof raw === "string" ? raw.toLowerCase() : null;
      return !!needle && !!value && value.includes(needle);
    }
    default:
      return false;
  }
}

function ruleHolds(
  rule: Rule,
  byKey: ReadonlyMap<string, Question>,
  visible: ReadonlySet<string>,
  answers: Record<string, unknown>,
): boolean {
  const holds = (c: Condition) => {
    const source = byKey.get(c.questionKey);
    return !!source && visible.has(source.key) && conditionHolds(c, source, answers[source.key]);
  };
  if (rule.conditions.length === 0) return false;
  return rule.match === "any" ? rule.conditions.some(holds) : rule.conditions.every(holds);
}

// Walks the form in order. A rule can only look at earlier questions, so one
// pass settles everything: a hidden source counts as unanswered, a rule on a
// source that comes later or doesn't exist fails, and a page break's rule
// hides every question up to the next page break.
export function visibleKeys(
  questions: Question[],
  answers: Record<string, unknown>,
): Set<string> {
  const visible = new Set<string>();
  const byKey = new Map<string, Question>();
  let pageShown = true;
  for (const q of questions) {
    const rule = ruleOf(q.data.showIf);
    const own = !rule || ruleHolds(rule, byKey, visible, answers);
    if (q.type === "pageBreak") pageShown = own;
    if (own && (pageShown || q.type === "pageBreak")) visible.add(q.key);
    byKey.set(q.key, q);
  }
  return visible;
}

// Keys shown only sometimes: their own rule, or a rule on their page.
export function conditionalKeys(questions: Question[]): Set<string> {
  const keys = new Set<string>();
  let pageRule = false;
  for (const q of questions) {
    if (q.type === "pageBreak") {
      pageRule = !!q.data.showIf;
      continue;
    }
    if (q.data.showIf || pageRule) keys.add(q.key);
  }
  return keys;
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

function conditionProblem(
  q: Question,
  c: Condition,
  index: number,
  indexByKey: ReadonlyMap<string, number>,
  questions: Question[],
): string | null {
  const sourceIndex = indexByKey.get(c.questionKey);
  if (sourceIndex === undefined) return `${nameOf(q)} depends on a question that was deleted.`;
  const source = questions[sourceIndex];
  if (sourceIndex >= index) {
    return `${nameOf(q)} depends on ${nameOf(source)}, which now comes after it.`;
  }
  if (!canBeSource(source)) {
    return `${nameOf(q)} depends on ${nameOf(source)}, which can't be used in a condition.`;
  }
  if (!opsForSource(source).includes(c.op)) {
    return `${nameOf(q)} has a condition that doesn't fit ${nameOf(source)}.`;
  }
  const [first] = c.values;
  switch (valueInput(source, c.op)) {
    case "pick": {
      if (c.values.length === 0) return `${nameOf(q)} has a condition with no answer picked.`;
      if (source.type === "reference") return null;
      const allowed = valuesForSource(source);
      const gone = c.values.find((v) => !allowed.includes(v));
      return gone === undefined
        ? null
        : `${nameOf(q)} depends on "${valueLabel(source, gone)}", which is no longer an option of ${nameOf(source)}.`;
    }
    case "pickOne":
      return c.values.length === 1 && SCALE_VALUES.includes(first)
        ? null
        : `${nameOf(q)} depends on "${first ?? ""}", which is no longer an option of ${nameOf(source)}.`;
    case "number":
      return c.values.length === 1 && NUMBER_PATTERN.test(first)
        ? null
        : `${nameOf(q)} needs a number in its condition.`;
    case "date":
      return c.values.length === 1 && DATE_PATTERN.test(first)
        ? null
        : `${nameOf(q)} needs a date in its condition.`;
    case "text":
      return c.values.length === 1 && first.trim() !== ""
        ? null
        : `${nameOf(q)} needs some text in its condition.`;
    default:
      return null;
  }
}

// Everything that makes a rule unusable. `mapped` names, per question key, the
// feature that reads that answer, so a mapped question can't be conditional,
// and neither can the page it sits on.
export function showIfProblems(
  questions: Question[],
  mapped?: ReadonlyMap<string, string>,
): ShowIfProblem[] {
  const problems: ShowIfProblem[] = [];
  const indexByKey = new Map(questions.map((q, i) => [q.key, i]));
  const flaggedPages = new Set<string>();
  let page: Question | null = null;
  questions.forEach((q, index) => {
    if (q.type === "pageBreak") page = q;
    const feature = mapped?.get(q.key);
    const rule = ruleOf(q.data.showIf);
    if (feature && rule) {
      problems.push({ key: q.key, message: `${nameOf(q)} is used by ${feature} and always has to be shown.` });
      return;
    }
    const pageWithRule: Question | null = page;
    if (feature && pageWithRule && pageWithRule.data.showIf && !flaggedPages.has(pageWithRule.key)) {
      flaggedPages.add(pageWithRule.key);
      problems.push({
        key: pageWithRule.key,
        message: `${nameOf(pageWithRule)} can't have a condition because ${nameOf(q)} on its page is used by ${feature}.`,
      });
    }
    if (!rule) return;
    if (rule.conditions.length === 0) {
      problems.push({ key: q.key, message: `${nameOf(q)} has a condition with nothing in it.` });
      return;
    }
    for (const c of rule.conditions) {
      const message = conditionProblem(q, c, index, indexByKey, questions);
      if (message) {
        problems.push({ key: q.key, message });
        return;
      }
    }
  });
  return problems;
}

export function conditionSentence(
  c: Condition,
  numbers: ReadonlyMap<string, number>,
  byKey?: ReadonlyMap<string, Question>,
): string {
  const n = numbers.get(c.questionKey);
  const source = byKey?.get(c.questionKey);
  const subject = n ? `Q${n}` : "A deleted question";
  const input = source
    ? valueInput(source, c.op)
    : c.op === "answered" || c.op === "blank"
      ? "none"
      : "pick";
  const value =
    input === "none"
      ? ""
      : input === "pick"
        ? c.values.map((v, i) => valueLabel(source, v, c.labels?.[i])).join(" or ")
        : input === "text"
          ? `"${c.values[0] ?? ""}"`
          : (c.values[0] ?? "");
  return [subject, opLabel(c.op, source?.type), value].filter(Boolean).join(" ");
}

// "Q2 is No", "Q3 is at least 4 and Q5 is answered".
export function showIfSentence(
  showIf: ShowIfRule,
  numbers: ReadonlyMap<string, number>,
  questions?: Question[],
): string {
  const rule = ruleOf(showIf);
  if (!rule) return "";
  const byKey = questions ? new Map(questions.map((q) => [q.key, q])) : undefined;
  return rule.conditions
    .map((c) => conditionSentence(c, numbers, byKey))
    .join(rule.match === "any" ? " or " : " and ");
}

// Everything that decides whether `key` is shown: its page's rule, then its own.
export function shownWhenSentence(questions: Question[], key: string): string {
  const numbers = questionNumbers(questions);
  const index = questions.findIndex((q) => q.key === key);
  if (index < 0) return "";
  const page = questions
    .slice(0, index)
    .reverse()
    .find((q) => q.type === "pageBreak");
  return [page?.data.showIf, questions[index].data.showIf]
    .filter((rule): rule is ShowIfRule => !!rule)
    .map((rule) => showIfSentence(rule, numbers, questions))
    .join(" and ");
}

// How deep a question sits under the ones it depends on (0 when unconditional
// and for page breaks). Conditions that don't resolve count as depth 0.
export function ruleDepths(questions: Question[]): Map<string, number> {
  const depths = new Map<string, number>();
  for (const q of questions) {
    const rule = q.type === "pageBreak" ? null : ruleOf(q.data.showIf);
    let depth = 0;
    for (const c of rule?.conditions ?? []) {
      const source = depths.get(c.questionKey);
      if (source !== undefined) depth = Math.max(depth, source + 1);
    }
    depths.set(q.key, depth);
  }
  return depths;
}
