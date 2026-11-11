import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { versionResponsesWhere } from "~/forms/lib/version-responses.server";
import { parseAnswerFilters, type AnswerFilter } from "~/forms/lib/answer-filters";
import type { Question } from "~/types";
import { makeUser } from "../../../../integration/factories-misc";

const q = (key: string, type: Question["type"], data: Partial<Question["data"]> = {}): Question => ({
  key,
  type,
  required: false,
  data: { label: `Question ${key}`, ...data },
});

const QUESTIONS: Question[] = [
  q("sel", "select", { options: ["Red", "Blue"] }),
  q("rad", "radio", { options: ["Cat", "Dog"], allowOther: true }),
  q("chk", "checkbox", { options: ["A", "B", "C"], allowOther: true }),
  q("txt", "text"),
  q("num", "number"),
  q("day", "date"),
  q("rate", "scale"),
];

let formId: string;
let versionId: string;
let otherVersionId: string;
const ids: Record<string, string> = {};

async function submit(name: string, answers: Record<string, unknown>, version = versionId) {
  const row = await prisma.formSubmission.create({
    data: { formId, formVersionId: version, submitterName: name, answers: answers as never },
  });
  ids[name] = row.id;
}

async function match(filters: AnswerFilter[], q = "", version = versionId) {
  const where = await versionResponsesWhere(formId, version, { q, answers: filters, questions: QUESTIONS });
  const rows = await prisma.formSubmission.findMany({ where, select: { submitterName: true } });
  return rows.map((r) => r.submitterName!).sort();
}

beforeEach(async () => {
  const user = await makeUser();
  const page = await prisma.page.create({
    data: { workspaceType: "Lab", title: "Intake", kind: "Form", createdById: user.id },
  });
  formId = (await prisma.form.create({ data: { id: page.id, name: "Intake", createdById: user.id } })).id;
  const version = (n: number) =>
    prisma.formVersion.create({
      data: { formId, versionNumber: n, questions: QUESTIONS as never, createdById: user.id },
    });
  versionId = (await version(1)).id;
  otherVersionId = (await version(2)).id;

  await submit("ada", {
    sel: "Red",
    rad: "Cat",
    chk: ["A", "B"],
    txt: "Loves Rust and 100% effort",
    num: "7",
    day: "2026-03-10",
    rate: "5",
  });
  await submit("bob", {
    sel: "Blue",
    rad: "Parrot",
    chk: ["C", "Mango"],
    txt: "Prefers go_lang",
    num: "12.5",
    day: "2026-06-01",
    rate: "2",
  });
  await submit("cy", { sel: "", rad: null, chk: [], txt: "", num: "n/a", day: "" });
  await submit("dee", {});
  await submit("eli", { sel: "Red", txt: "rust", num: "7", chk: "A" });
  await submit("other-version", { sel: "Red", txt: "rust" }, otherVersionId);
});

describe("select and radio", () => {
  it("is: equals any of the values", async () => {
    expect(await match([{ key: "sel", kind: "is", values: ["Red"] }])).toEqual(["ada", "eli"]);
    expect(await match([{ key: "sel", kind: "is", values: ["Red", "Blue"] }])).toEqual(["ada", "bob", "eli"]);
  });

  it("is Other: a non-empty answer outside the options", async () => {
    expect(await match([{ key: "rad", kind: "is", values: ["__other__"] }])).toEqual(["bob"]);
    expect(await match([{ key: "rad", kind: "is", values: ["Cat", "__other__"] }])).toEqual(["ada", "bob"]);
  });
});

describe("checkbox", () => {
  it("is: the array includes any value, and a plain string counts as one value", async () => {
    expect(await match([{ key: "chk", kind: "is", values: ["A"] }])).toEqual(["ada", "eli"]);
    expect(await match([{ key: "chk", kind: "is", values: ["B", "C"] }])).toEqual(["ada", "bob"]);
  });

  it("is Other: any element outside the options", async () => {
    expect(await match([{ key: "chk", kind: "is", values: ["__other__"] }])).toEqual(["bob"]);
  });
});

describe("text contains", () => {
  it("is case-insensitive", async () => {
    expect(await match([{ key: "txt", kind: "contains", text: "RUST" }])).toEqual(["ada", "eli"]);
  });

  it("treats % and _ as plain characters", async () => {
    expect(await match([{ key: "txt", kind: "contains", text: "100%" }])).toEqual(["ada"]);
    expect(await match([{ key: "txt", kind: "contains", text: "go_lang" }])).toEqual(["bob"]);
    expect(await match([{ key: "txt", kind: "contains", text: "go_ang" }])).toEqual([]);
    expect(await match([{ key: "txt", kind: "contains", text: "%" }])).toEqual(["ada"]);
    expect(await match([{ key: "txt", kind: "contains", text: "_" }])).toEqual(["bob"]);
  });
});

describe("number range", () => {
  it("is inclusive and never matches a non-numeric value", async () => {
    expect(await match([{ key: "num", kind: "range", min: "7" }])).toEqual(["ada", "bob", "eli"]);
    expect(await match([{ key: "num", kind: "range", max: "7" }])).toEqual(["ada", "eli"]);
    expect(await match([{ key: "num", kind: "range", min: "8", max: "12.5" }])).toEqual(["bob"]);
    expect(await match([{ key: "num", kind: "range", min: "-100" }])).toEqual(["ada", "bob", "eli"]);
  });
});

describe("date range", () => {
  it("compares YYYY-MM-DD strings inclusively and skips blanks", async () => {
    expect(await match([{ key: "day", kind: "range", min: "2026-03-10" }])).toEqual(["ada", "bob"]);
    expect(await match([{ key: "day", kind: "range", max: "2026-03-10" }])).toEqual(["ada"]);
    expect(await match([{ key: "day", kind: "range", min: "2026-04-01", max: "2026-12-31" }])).toEqual(["bob"]);
  });
});

describe("answered and blank", () => {
  it("blank covers a missing key, null, empty text and an empty list", async () => {
    expect(await match([{ key: "sel", kind: "blank" }])).toEqual(["cy", "dee"]);
    expect(await match([{ key: "rad", kind: "blank" }])).toEqual(["cy", "dee", "eli"]);
    expect(await match([{ key: "chk", kind: "blank" }])).toEqual(["cy", "dee"]);
    expect(await match([{ key: "txt", kind: "blank" }])).toEqual(["cy", "dee"]);
  });

  it("answered is the complement", async () => {
    expect(await match([{ key: "sel", kind: "answered" }])).toEqual(["ada", "bob", "eli"]);
    expect(await match([{ key: "chk", kind: "answered" }])).toEqual(["ada", "bob", "eli"]);
  });
});

describe("combining", () => {
  it("ANDs filters across questions", async () => {
    expect(
      await match([
        { key: "sel", kind: "is", values: ["Red"] },
        { key: "num", kind: "range", min: "7", max: "7" },
        { key: "txt", kind: "contains", text: "rust" },
      ]),
    ).toEqual(["ada", "eli"]);
    expect(
      await match([
        { key: "sel", kind: "is", values: ["Red"] },
        { key: "chk", kind: "is", values: ["B"] },
      ]),
    ).toEqual(["ada"]);
  });

  it("stays inside the version", async () => {
    expect(await match([{ key: "sel", kind: "is", values: ["Red"] }], "", otherVersionId)).toEqual(["other-version"]);
  });

  it("returns nothing when nobody matches", async () => {
    expect(await match([{ key: "sel", kind: "is", values: ["Green"] }])).toEqual([]);
  });

  it("accepts filters parsed from a URL", async () => {
    const filters = parseAnswerFilters(["sel:is:Red", "num:min:7", "num:max:7"], QUESTIONS);
    expect(await match(filters)).toEqual(["ada", "eli"]);
  });
});

describe("search", () => {
  it("matches an answer value, case-insensitively", async () => {
    expect(await match([], "RUST")).toEqual(["ada", "eli"]);
    expect(await match([], "mango")).toEqual(["bob"]);
  });

  it("does not match a question key", async () => {
    expect(await match([], "txt")).toEqual([]);
    expect(await match([], "sel")).toEqual([]);
  });

  it("still matches the respondent's name", async () => {
    expect(await match([], "ada")).toEqual(["ada"]);
  });

  it("requires every word, each in the name or an answer", async () => {
    expect(await match([], "ada rust")).toEqual(["ada"]);
    expect(await match([], "bob rust")).toEqual([]);
  });

  it("treats % and _ in the search as plain characters", async () => {
    expect(await match([], "100%")).toEqual(["ada"]);
    expect(await match([], "go_ang")).toEqual([]);
  });

  it("ANDs with the answer filters", async () => {
    expect(await match([{ key: "sel", kind: "is", values: ["Blue"] }], "rust")).toEqual([]);
    expect(await match([{ key: "sel", kind: "is", values: ["Red"] }], "rust")).toEqual(["ada", "eli"]);
  });
});
