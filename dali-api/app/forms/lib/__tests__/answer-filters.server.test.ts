import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { $queryRawUnsafe: vi.fn() } }));

import { prisma } from "~/lib/db.server";
import {
  answerFilterQuery,
  answerTextQuery,
  escapeLike,
  resolveAnswerMatches,
} from "~/forms/lib/answer-filters.server";
import type { AnswerFilter } from "~/forms/lib/answer-filters";
import type { Question } from "~/types";

const raw = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;

const q = (key: string, type: Question["type"], data: Partial<Question["data"]> = {}): Question => ({
  key,
  type,
  required: false,
  data: { label: key, ...data },
});
const questions = [
  q("sel", "select", { options: ["A", "B"] }),
  q("rad", "radio", { options: ["A", "B"], allowOther: true }),
  q("chk", "checkbox", { options: ["A", "B"], allowOther: true }),
  q("txt", "text"),
  q("num", "number"),
  q("day", "date"),
];

const build = (...filters: AnswerFilter[]) => answerFilterQuery("v1", filters, questions);

// A hostile key or value must only ever travel as a parameter.
const EVIL = `x'); DROP TABLE "FormSubmission"; --`;

describe("escapeLike", () => {
  it("escapes the wildcards and the escape character", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("answerFilterQuery", () => {
  it("scopes to the version and starts with no filters", () => {
    const { sql, params } = build();
    expect(sql).toBe(`SELECT s."id" FROM "FormSubmission" s WHERE s."formVersionId" = $1`);
    expect(params).toEqual(["v1"]);
  });

  it("is: sends the key and values as params", () => {
    const { sql, params } = build({ key: "sel", kind: "is", values: ["A", EVIL] });
    expect(params).toEqual(["v1", "sel", JSON.stringify(["A", EVIL])]);
    expect(sql).toContain(`(s."answers" ->> $2::text) IN (SELECT jsonb_array_elements_text($3::jsonb))`);
    expect(sql).not.toContain("DROP TABLE");
  });

  it("is with Other: matches a non-empty answer outside the options", () => {
    const { sql, params } = build({ key: "rad", kind: "is", values: ["A", "__other__"] });
    expect(params).toEqual(["v1", "rad", JSON.stringify(["A"]), JSON.stringify(["A", "B"])]);
    expect(sql).toContain(`<> '' AND`);
    expect(sql).toContain("NOT IN (SELECT jsonb_array_elements_text($4::jsonb))");
  });

  it("is on a checkbox reads the answer as a list of elements", () => {
    const { sql, params } = build({ key: "chk", kind: "is", values: ["A", "__other__"] });
    expect(sql).toContain("jsonb_array_elements_text(CASE jsonb_typeof((s.\"answers\" -> $2::text)) WHEN 'array'");
    expect(sql).toContain(`e."v" IN`);
    expect(sql).toContain(`e."v" NOT IN`);
    expect(params).toEqual(["v1", "chk", JSON.stringify(["A"]), JSON.stringify(["A", "B"])]);
  });

  it("contains: escapes wildcards and sets the escape character", () => {
    const { sql, params } = build({ key: "txt", kind: "contains", text: "100%_x" });
    expect(params).toEqual(["v1", "txt", "%100\\%\\_x%"]);
    expect(sql).toContain(`ILIKE $3 ESCAPE '\\'`);
  });

  it("number range: casts only values that look like numbers", () => {
    const { sql, params } = build({ key: "num", kind: "range", min: "3", max: "9.5" });
    expect(params).toEqual(["v1", "num", "^-?\\d+(\\.\\d+)?$", "3", "9.5"]);
    expect(sql).toContain("CASE WHEN");
    expect(sql).toContain("::numeric END >= $4::numeric");
    expect(sql).toContain("<= $5::numeric");
  });

  it("date range: compares strings in the C collation behind a shape check", () => {
    const { sql, params } = build({ key: "day", kind: "range", min: "2026-01-01" });
    expect(params).toEqual(["v1", "day", "^\\d{4}-\\d{2}-\\d{2}$", "2026-01-01"]);
    expect(sql).toContain(`COLLATE "C" >= $4::text`);
    expect(sql).toContain("~ $3::text");
  });

  it("answered and blank cover a missing key, null, empty text and an empty list", () => {
    const blank = build({ key: "txt", kind: "blank" });
    expect(blank.sql).toContain("IS NULL");
    expect(blank.sql).toContain("= 'null'");
    expect(blank.sql).toContain("btrim");
    expect(blank.sql).toContain("jsonb_array_length");
    expect(blank.params).toEqual(["v1", "txt"]);
    expect(build({ key: "txt", kind: "answered" }).sql).toContain("AND NOT (");
  });

  it("ANDs one condition per filter with separate params", () => {
    const { sql, params } = build(
      { key: "sel", kind: "is", values: ["A"] },
      { key: "txt", kind: "contains", text: "hi" },
    );
    expect(params).toEqual(["v1", "sel", JSON.stringify(["A"]), "txt", "%hi%"]);
    expect(sql.match(/ AND /g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores a filter whose question isn't in the version", () => {
    expect(build({ key: "gone", kind: "blank" }).params).toEqual(["v1"]);
  });
});

describe("answerTextQuery", () => {
  it("searches values only and passes the words as escaped patterns", () => {
    const { sql, params } = answerTextQuery("v1", ["ada", "50%"]);
    expect(params).toEqual(["v1", JSON.stringify(["%ada%", "%50\\%%"])]);
    expect(sql).toContain("jsonb_each_text");
    expect(sql).toContain(`e."v" ILIKE w."pattern" ESCAPE '\\'`);
    expect(sql).not.toContain(`e."k" ILIKE`);
  });
});

describe("resolveAnswerMatches", () => {
  beforeEach(() => vi.resetAllMocks());

  it("runs nothing without filters or words", async () => {
    expect(await resolveAnswerMatches("v1", questions, {})).toEqual({ filterIds: null, wordIds: [] });
    expect(raw).not.toHaveBeenCalled();
  });

  it("returns the filter ids and groups word matches by word", async () => {
    raw.mockImplementation(async (sql: string) =>
      sql.includes("jsonb_each_text")
        ? [
            { id: "s1", word: 1 },
            { id: "s2", word: 2 },
            { id: "s3", word: 2 },
          ]
        : [{ id: "s1" }, { id: "s9" }],
    );
    const out = await resolveAnswerMatches("v1", questions, {
      answers: [{ key: "txt", kind: "blank" }],
      words: ["a", "b"],
    });
    expect(out).toEqual({ filterIds: ["s1", "s9"], wordIds: [["s1"], ["s2", "s3"]] });
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it("reports no ids for a filter nobody matches", async () => {
    raw.mockResolvedValue([]);
    const out = await resolveAnswerMatches("v1", questions, { answers: [{ key: "txt", kind: "blank" }] });
    expect(out).toEqual({ filterIds: [], wordIds: [] });
  });
});
