import type { Question } from "~/types";
import { NUMBER_PATTERN } from "~/forms/lib/version-summary";
import { OTHER_VALUE, questionNumbers } from "~/lib/form-logic";

export { OTHER_VALUE };
export const ANSWER_PARAM = "a";
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type AnswerFilter =
  | { key: string; kind: "is"; values: string[] }
  | { key: string; kind: "contains"; text: string }
  | { key: string; kind: "range"; min?: string; max?: string }
  | { key: string; kind: "answered" }
  | { key: string; kind: "blank" };

export type FilterKind = AnswerFilter["kind"];

const IS_TYPES = new Set<Question["type"]>(["select", "radio", "scale", "checkbox", "reference"]);
const CONTAINS_TYPES = new Set<Question["type"]>([
  "text",
  "textarea",
  "email",
  "github_url",
  "figma_url",
  "drive_url",
]);
const RANGE_TYPES = new Set<Question["type"]>(["number", "date"]);

type Typed = Pick<Question, "key" | "type">;

export function primaryKind(type: Question["type"]): FilterKind | null {
  if (IS_TYPES.has(type)) return "is";
  if (CONTAINS_TYPES.has(type)) return "contains";
  if (RANGE_TYPES.has(type)) return "range";
  return null;
}

export function allowedKinds(type: Question["type"]): FilterKind[] {
  const primary = primaryKind(type);
  return primary ? [primary, "answered", "blank"] : [];
}

function validBound(type: Question["type"], value: string): boolean {
  return type === "date" ? DATE_PATTERN.test(value) : NUMBER_PATTERN.test(value);
}

function opOf(op: string): FilterKind | "min" | "max" | null {
  switch (op) {
    case "is":
      return "is";
    case "has":
      return "contains";
    case "min":
    case "max":
    case "answered":
    case "blank":
      return op;
    default:
      return null;
  }
}

export function parseAnswerFilters(
  raw: Iterable<string> | URLSearchParams,
  questions: ReadonlyArray<Typed>,
): AnswerFilter[] {
  const entries = raw instanceof URLSearchParams ? raw.getAll(ANSWER_PARAM) : [...raw];
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const out = new Map<string, AnswerFilter>();
  for (const entry of entries) {
    const first = entry.indexOf(":");
    if (first < 0) continue;
    const second = entry.indexOf(":", first + 1);
    const key = entry.slice(0, first);
    const op = opOf(second < 0 ? entry.slice(first + 1) : entry.slice(first + 1, second));
    const value = second < 0 ? "" : entry.slice(second + 1);
    const question = byKey.get(key);
    if (!question || !op) continue;
    const kind: FilterKind = op === "min" || op === "max" ? "range" : op;
    if (!allowedKinds(question.type).includes(kind)) continue;
    const existing = out.get(key);
    if (existing && existing.kind !== kind) continue;
    switch (kind) {
      case "is": {
        if (!value) break;
        if (existing?.kind === "is") {
          if (!existing.values.includes(value)) existing.values.push(value);
        } else out.set(key, { key, kind, values: [value] });
        break;
      }
      case "contains": {
        const text = value.trim();
        if (text && !existing) out.set(key, { key, kind, text });
        break;
      }
      case "range": {
        if (!validBound(question.type, value)) break;
        const bound = op === "min" ? { min: value } : { max: value };
        out.set(key, { ...(existing?.kind === "range" ? existing : {}), key, kind, ...bound });
        break;
      }
      default:
        out.set(key, { key, kind } as AnswerFilter);
    }
  }
  return [...out.values()];
}

export function serializeAnswerFilters(filters: ReadonlyArray<AnswerFilter>): string[] {
  return filters.flatMap((f): string[] => {
    switch (f.kind) {
      case "is":
        return f.values.map((v) => `${f.key}:is:${v}`);
      case "contains":
        return [`${f.key}:has:${f.text}`];
      case "range":
        return [
          ...(f.min !== undefined ? [`${f.key}:min:${f.min}`] : []),
          ...(f.max !== undefined ? [`${f.key}:max:${f.max}`] : []),
        ];
      default:
        return [`${f.key}:${f.kind}`];
    }
  });
}

export function isEmptyFilter(f: AnswerFilter): boolean {
  if (f.kind === "is") return f.values.length === 0;
  if (f.kind === "contains") return f.text.trim() === "";
  if (f.kind === "range") return f.min === undefined && f.max === undefined;
  return false;
}

export function withAnswerFilters(
  params: URLSearchParams,
  filters: ReadonlyArray<AnswerFilter>,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(ANSWER_PARAM);
  next.delete("page");
  for (const entry of serializeAnswerFilters(filters.filter((f) => !isEmptyFilter(f)))) {
    next.append(ANSWER_PARAM, entry);
  }
  return next;
}

export type FilterOption = { value: string; label: string };

export type FilterableQuestion = {
  key: string;
  label: string;
  type: Question["type"];
  number?: number;
  primary: FilterKind;
  options?: FilterOption[];
};

type RefLabels = ReadonlyMap<string, ReadonlyMap<string, string>>;

function optionsFor(q: Question, refLabels?: RefLabels): FilterOption[] | undefined {
  switch (q.type) {
    case "select":
    case "radio":
    case "checkbox": {
      const options = (q.data.options ?? []).map((o) => ({ value: o, label: o }));
      return q.type !== "select" && q.data.allowOther
        ? [...options, { value: OTHER_VALUE, label: "Other" }]
        : options;
    }
    case "scale":
      return ["1", "2", "3", "4", "5"].map((v) => ({
        value: v,
        label:
          v === "1" && q.data.scaleLow
            ? `1 (${q.data.scaleLow})`
            : v === "5" && q.data.scaleHigh
              ? `5 (${q.data.scaleHigh})`
              : v,
      }));
    case "reference":
      return [...(refLabels?.get(q.key) ?? [])]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    default:
      return undefined;
  }
}

export function filterableQuestions(
  questions: ReadonlyArray<Question>,
  refLabels?: RefLabels,
): FilterableQuestion[] {
  const numbers = questionNumbers([...questions]);
  return questions.flatMap((q) => {
    const primary = primaryKind(q.type);
    if (!primary) return [];
    const options = optionsFor(q, refLabels);
    return [
      {
        key: q.key,
        label: q.data.label,
        type: q.type,
        ...(numbers.has(q.key) ? { number: numbers.get(q.key) } : {}),
        primary,
        ...(options ? { options } : {}),
      },
    ];
  });
}

export function filterSummary(filter: AnswerFilter, question: FilterableQuestion): string {
  switch (filter.kind) {
    case "is": {
      const names = new Map((question.options ?? []).map((o) => [o.value, o.label]));
      const labels = filter.values.map((v) => names.get(v) ?? v);
      return labels.length <= 2 ? labels.join(", ") : `${labels[0]} +${labels.length - 1}`;
    }
    case "contains":
      return `"${filter.text}"`;
    case "range":
      if (filter.min !== undefined && filter.max !== undefined) return `${filter.min} to ${filter.max}`;
      return filter.min !== undefined ? `${filter.min} or more` : `${filter.max} or less`;
    case "answered":
      return "Answered";
    case "blank":
      return "No answer";
  }
}

export type AnswerFilterInput = {
  questionKey?: unknown;
  kind?: unknown;
  values?: unknown;
  text?: unknown;
  min?: unknown;
  max?: unknown;
};

const KIND_NAMES: FilterKind[] = ["is", "contains", "range", "answered", "blank"];

// Unlike parseAnswerFilters this names every problem instead of dropping it.
export function validateAnswerFilterInputs(
  inputs: ReadonlyArray<AnswerFilterInput>,
  questions: ReadonlyArray<Question>,
): { filters: AnswerFilter[]; errors: string[] } {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const filters: AnswerFilter[] = [];
  const errors: string[] = [];
  inputs.forEach((input, i) => {
    const at = `answers[${i}]`;
    const key = input.questionKey;
    const question = typeof key === "string" ? byKey.get(key) : undefined;
    if (!question) {
      errors.push(`${at}: questionKey ${JSON.stringify(key)} is not a question in this version`);
      return;
    }
    const kind = input.kind as FilterKind;
    if (!KIND_NAMES.includes(kind)) {
      errors.push(`${at}: kind must be one of ${KIND_NAMES.join(", ")}`);
      return;
    }
    const allowed = allowedKinds(question.type);
    if (!allowed.includes(kind)) {
      errors.push(
        allowed.length
          ? `${at}: a ${question.type} question ("${question.data.label}") supports kind ${allowed.join(", ")}, not ${kind}`
          : `${at}: ${question.type} questions can't be filtered ("${question.data.label}")`,
      );
      return;
    }
    if (filters.some((f) => f.key === question.key)) {
      errors.push(`${at}: only one filter per question; "${question.data.label}" appears twice`);
      return;
    }
    switch (kind) {
      case "is": {
        const values = Array.isArray(input.values) ? input.values : [];
        if (values.length === 0 || values.some((v) => typeof v !== "string" || v === "")) {
          errors.push(`${at}: kind is needs values, a non-empty list of strings`);
          return;
        }
        const offered = optionsFor(question)?.map((o) => o.value) ?? [];
        const unknown =
          question.type === "reference" ? [] : (values as string[]).filter((v) => !offered.includes(v));
        if (unknown.length) {
          errors.push(
            `${at}: ${unknown.map((v) => JSON.stringify(v)).join(", ")} is not an option of "${question.data.label}" (options: ${offered.join(", ")})`,
          );
          return;
        }
        filters.push({ key: question.key, kind, values: [...new Set(values as string[])] });
        return;
      }
      case "contains": {
        const text = typeof input.text === "string" ? input.text.trim() : "";
        if (!text) {
          errors.push(`${at}: kind contains needs non-empty text`);
          return;
        }
        filters.push({ key: question.key, kind, text });
        return;
      }
      case "range": {
        const bounds: { min?: string; max?: string } = {};
        for (const edge of ["min", "max"] as const) {
          const value = input[edge];
          if (value === undefined || value === null) continue;
          const text = typeof value === "number" ? String(value) : value;
          if (typeof text !== "string" || !validBound(question.type, text)) {
            errors.push(
              `${at}: ${edge} must be ${question.type === "date" ? "a YYYY-MM-DD date" : "a number"}`,
            );
            return;
          }
          bounds[edge] = text;
        }
        if (bounds.min === undefined && bounds.max === undefined) {
          errors.push(`${at}: kind range needs min, max or both`);
          return;
        }
        filters.push({ key: question.key, kind, ...bounds });
        return;
      }
      default:
        filters.push({ key: question.key, kind } as AnswerFilter);
    }
  });
  return { filters, errors };
}
