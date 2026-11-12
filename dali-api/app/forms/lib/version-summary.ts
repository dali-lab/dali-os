import type { Question } from "~/types";
import { isLayoutOnly } from "~/forms/lib/form-answers";
import { parseSkillsRating } from "~/lib/skills-rating";
import { conditionalKeys, questionNumbers, shownWhenSentence, visibleKeys } from "~/forms/lib/form-logic";

export type Bar = { label: string; count: number; percent: number; other?: boolean };

export type SkillRow = {
  skill: string;
  rated: number;
  average: number | null;
  distribution: number[];
};

// `asked` is set only on a conditional question: how many responses were shown
// it, and who they were. Everyone else is left out of answered and skipped.
type Base = {
  key: string;
  number: number;
  label: string;
  answered: number;
  skipped: number;
  asked?: { count: number; who: string };
};

export type QuestionSummary =
  | (Base & { kind: "choice"; bars: Bar[] })
  | (Base & { kind: "skills"; skills: SkillRow[] })
  | (Base & { kind: "scale"; average: number | null; bars: Bar[] })
  | (Base & {
      kind: "number";
      count: number;
      average: number | null;
      lowest: number | null;
      highest: number | null;
    })
  | (Base & { kind: "text" });

export type ResponsesSummary = { total: number; questions: QuestionSummary[] };

type RefLabels = ReadonlyMap<string, ReadonlyMap<string, string>>;

export const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;
const SCALE_VALUES = ["1", "2", "3", "4", "5"];

function percentOf(count: number, answered: number): number {
  return answered === 0 ? 0 : Math.round((count / answered) * 100);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function asText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
}

// Checkbox answers are string[] on submissions and a JSON-stringified array on
// hiring answers. A plain string counts as one selected value.
function selectedValues(raw: unknown): string[] {
  let values: unknown[] = [];
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === "string" && raw.trim()) {
    const text = raw.trim();
    let parsed: unknown = null;
    if (text.startsWith("[")) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    values = Array.isArray(parsed) ? parsed : [text];
  }
  const cleaned = values.map(asText).filter(Boolean);
  return [...new Set(cleaned)];
}

function choiceOptions(q: Question, refLabels?: RefLabels): { value: string; label: string }[] {
  if (q.type === "reference") {
    return [...(refLabels?.get(q.key) ?? [])].map(([value, label]) => ({ value, label }));
  }
  return (q.data.options ?? []).map((o) => ({ value: o, label: o }));
}

function summarizeChoice(q: Question, answers: unknown[], refLabels?: RefLabels): Bar[] {
  const options = choiceOptions(q, refLabels);
  const counts = new Map(options.map((o) => [o.value, 0]));
  let answered = 0;
  let other = 0;
  for (const raw of answers) {
    const values = q.type === "checkbox" ? selectedValues(raw) : [asText(raw)].filter(Boolean);
    if (values.length === 0) continue;
    answered++;
    let hasOther = false;
    for (const v of values) {
      if (counts.has(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
      else hasOther = true;
    }
    if (hasOther) other++;
  }
  const bars: Bar[] = options.map((o) => {
    const count = counts.get(o.value) ?? 0;
    return { label: o.label, count, percent: percentOf(count, answered) };
  });
  if (q.type === "reference") bars.sort((a, b) => b.count - a.count);
  if (other > 0) {
    bars.push({ label: "Other", count: other, percent: percentOf(other, answered), other: true });
  }
  return bars;
}

function answeredCount(q: Question, answers: unknown[]): number {
  if (q.type === "checkbox") return answers.filter((a) => selectedValues(a).length > 0).length;
  if (q.type === "skills_rating") {
    const skills = new Set(q.data.options ?? []);
    return answers.filter((a) =>
      Object.entries(parseSkillsRating(typeof a === "string" ? a : "")).some(
        ([skill, rating]) => skills.has(skill) && /^[0-5]$/.test(rating),
      ),
    ).length;
  }
  return answers.filter((a) => asText(a) !== "").length;
}

function summarizeSkills(q: Question, answers: unknown[]): SkillRow[] {
  const parsed = answers.map((a) => parseSkillsRating(typeof a === "string" ? a : ""));
  return (q.data.options ?? []).map((skill) => {
    const distribution = [0, 0, 0, 0, 0, 0];
    for (const ratings of parsed) {
      const rating = ratings[skill];
      if (rating !== undefined && /^[0-5]$/.test(rating)) distribution[Number(rating)]++;
    }
    const rated = distribution.reduce((a, b) => a + b, 0);
    const sum = distribution.reduce((acc, n, rating) => acc + n * rating, 0);
    return { skill, rated, average: rated ? round(sum / rated, 1) : null, distribution };
  });
}

function summarizeScale(answers: unknown[]): { average: number | null; bars: Bar[] } {
  const counts = SCALE_VALUES.map(
    (v) => answers.filter((a) => asText(a) === v).length,
  );
  const valid = counts.reduce((a, b) => a + b, 0);
  const sum = counts.reduce((acc, n, i) => acc + n * (i + 1), 0);
  return {
    average: valid ? round(sum / valid, 1) : null,
    bars: counts.map((count, i) => ({
      label: SCALE_VALUES[i],
      count,
      percent: percentOf(count, valid),
    })),
  };
}

function summarizeNumber(answers: unknown[]) {
  const values = answers
    .map(asText)
    .filter((v) => NUMBER_PATTERN.test(v))
    .map(Number);
  if (values.length === 0) return { count: 0, average: null, lowest: null, highest: null };
  return {
    count: values.length,
    average: round(values.reduce((a, b) => a + b, 0) / values.length, 2),
    lowest: Math.min(...values),
    highest: Math.max(...values),
  };
}

export function summarizeResponses(
  questions: Question[],
  answersList: ReadonlyArray<Record<string, unknown>>,
  refLabels?: RefLabels,
): ResponsesSummary {
  const total = answersList.length;
  const numbers = questionNumbers(questions);
  const shown = answersList.map((a) => visibleKeys(questions, a ?? {}));
  const conditional = conditionalKeys(questions);
  const out: QuestionSummary[] = [];
  for (const q of questions) {
    if (isLayoutOnly(q.type)) continue;
    const number = numbers.get(q.key) ?? 0;
    const asked = conditional.has(q.key);
    const askedList = asked ? answersList.filter((_, i) => shown[i].has(q.key)) : answersList;
    const answers = askedList.map((a) => a?.[q.key]);
    const answered = answeredCount(q, answers);
    const base: Base = {
      key: q.key,
      number,
      label: q.data.label,
      answered,
      skipped: askedList.length - answered,
      ...(asked ? { asked: { count: askedList.length, who: `when ${shownWhenSentence(questions, q.key)}` } } : {}),
    };
    switch (q.type) {
      case "select":
      case "radio":
      case "checkbox":
      case "reference":
        out.push({ ...base, kind: "choice", bars: summarizeChoice(q, answers, refLabels) });
        break;
      case "skills_rating":
        out.push({ ...base, kind: "skills", skills: summarizeSkills(q, answers) });
        break;
      case "scale":
        out.push({ ...base, kind: "scale", ...summarizeScale(answers) });
        break;
      case "number":
        out.push({ ...base, kind: "number", ...summarizeNumber(answers) });
        break;
      default:
        out.push({ ...base, kind: "text" });
    }
  }
  return { total, questions: out };
}
