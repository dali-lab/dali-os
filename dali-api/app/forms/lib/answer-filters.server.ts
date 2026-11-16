import { prisma } from "~/lib/db.server";
import {
  DATE_PATTERN,
  OTHER_VALUE,
  type AnswerFilter,
} from "~/forms/lib/answer-filters";
import { NUMBER_PATTERN } from "~/forms/lib/version-summary";
import type { Question } from "~/types";

export type SqlQuery = { sql: string; params: unknown[] };
type Push = (value: unknown) => string;

export type AnswerMatches = {
  filterIds: string[] | null;
  wordIds: string[][];
};

export const NO_ANSWER_MATCHES: AnswerMatches = { filterIds: null, wordIds: [] };

export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const ANSWERS = `s."answers"`;

function newQuery(): { params: unknown[]; push: Push } {
  const params: unknown[] = [];
  return { params, push: (value) => `$${params.push(value)}` };
}

function listOf(push: Push, values: string[]): string {
  return `(SELECT jsonb_array_elements_text(${push(JSON.stringify(values))}::jsonb))`;
}

function isBlank(key: string): string {
  const cell = `(${ANSWERS} -> ${key}::text)`;
  return (
    `(${cell} IS NULL OR jsonb_typeof(${cell}) = 'null'` +
    ` OR (jsonb_typeof(${cell}) = 'string' AND btrim(${ANSWERS} ->> ${key}::text) = '')` +
    ` OR (jsonb_typeof(${cell}) = 'array' AND jsonb_array_length(${cell}) = 0))`
  );
}

function isCondition(f: Extract<AnswerFilter, { kind: "is" }>, q: Question, push: Push, key: string) {
  const plain = f.values.filter((v) => v !== OTHER_VALUE);
  const wantsOther = f.values.includes(OTHER_VALUE);
  const options = q.data.options ?? [];
  const test = (value: string) => {
    const parts: string[] = [];
    if (plain.length) parts.push(`${value} IN ${listOf(push, plain)}`);
    if (wantsOther) {
      parts.push(`(${value} <> '' AND ${value} NOT IN ${listOf(push, options)})`);
    }
    return parts.length ? `(${parts.join(" OR ")})` : "FALSE";
  };
  if (q.type !== "checkbox") return test(`(${ANSWERS} ->> ${key}::text)`);
  const cell = `(${ANSWERS} -> ${key}::text)`;
  const elements =
    `CASE jsonb_typeof(${cell}) WHEN 'array' THEN ${cell}` +
    ` WHEN 'string' THEN jsonb_build_array(${cell}) ELSE '[]'::jsonb END`;
  return `EXISTS (SELECT 1 FROM jsonb_array_elements_text(${elements}) AS e("v") WHERE ${test(`e."v"`)})`;
}

export function answerFilterCondition(f: AnswerFilter, q: Question, push: Push): string {
  const key = push(f.key);
  const text = `(${ANSWERS} ->> ${key}::text)`;
  switch (f.kind) {
    case "is":
      return isCondition(f, q, push, key);
    case "contains":
      return `${text} ILIKE ${push(`%${escapeLike(f.text)}%`)} ESCAPE '\\'`;
    case "answered":
      return `NOT ${isBlank(key)}`;
    case "blank":
      return isBlank(key);
    case "range": {
      const bounds: string[] = [];
      if (q.type === "date") {
        const shape = `${text} ~ ${push(DATE_PATTERN.source)}::text`;
        if (f.min !== undefined) bounds.push(`${text} COLLATE "C" >= ${push(f.min)}::text`);
        if (f.max !== undefined) bounds.push(`${text} COLLATE "C" <= ${push(f.max)}::text`);
        return `(${[shape, ...bounds].join(" AND ")})`;
      }
      const number = `CASE WHEN ${text} ~ ${push(NUMBER_PATTERN.source)}::text THEN ${text}::numeric END`;
      if (f.min !== undefined) bounds.push(`${number} >= ${push(f.min)}::numeric`);
      if (f.max !== undefined) bounds.push(`${number} <= ${push(f.max)}::numeric`);
      return `(${bounds.join(" AND ")})`;
    }
  }
}

export function answerFilterQuery(
  versionId: string,
  filters: ReadonlyArray<AnswerFilter>,
  questions: ReadonlyArray<Question>,
): SqlQuery {
  const { params, push } = newQuery();
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const conditions = [`s."formVersionId" = ${push(versionId)}`];
  for (const f of filters) {
    const q = byKey.get(f.key);
    if (q) conditions.push(answerFilterCondition(f, q, push));
  }
  return { sql: `SELECT s."id" FROM "FormSubmission" s WHERE ${conditions.join(" AND ")}`, params };
}

// Matches the words against answer values only, never the question keys.
export function answerTextQuery(versionId: string, words: ReadonlyArray<string>): SqlQuery {
  const { params, push } = newQuery();
  const version = push(versionId);
  const patterns = push(JSON.stringify(words.map((w) => `%${escapeLike(w)}%`)));
  return {
    sql:
      `SELECT s."id", w."i"::int AS "word" FROM "FormSubmission" s` +
      ` CROSS JOIN LATERAL jsonb_array_elements_text(${patterns}::jsonb) WITH ORDINALITY AS w("pattern", "i")` +
      ` WHERE s."formVersionId" = ${version}` +
      ` AND EXISTS (SELECT 1 FROM jsonb_each_text(CASE WHEN jsonb_typeof(${ANSWERS}) = 'object' THEN ${ANSWERS} ELSE '{}'::jsonb END) AS e("k", "v")` +
      ` WHERE e."v" ILIKE w."pattern" ESCAPE '\\')`,
    params,
  };
}

export async function resolveAnswerMatches(
  versionId: string,
  questions: ReadonlyArray<Question>,
  { answers = [], words = [] }: { answers?: ReadonlyArray<AnswerFilter>; words?: ReadonlyArray<string> },
): Promise<AnswerMatches> {
  if (answers.length === 0 && words.length === 0) return NO_ANSWER_MATCHES;
  const filterQuery = answers.length ? answerFilterQuery(versionId, answers, questions) : null;
  const textQuery = words.length ? answerTextQuery(versionId, words) : null;
  const [filterRows, textRows] = await Promise.all([
    filterQuery
      ? prisma.$queryRawUnsafe<{ id: string }[]>(filterQuery.sql, ...filterQuery.params)
      : null,
    textQuery
      ? prisma.$queryRawUnsafe<{ id: string; word: number }[]>(textQuery.sql, ...textQuery.params)
      : null,
  ]);
  const wordIds = words.map(() => [] as string[]);
  for (const row of textRows ?? []) wordIds[row.word - 1]?.push(row.id);
  return { filterIds: filterRows ? filterRows.map((r) => r.id) : null, wordIds };
}
