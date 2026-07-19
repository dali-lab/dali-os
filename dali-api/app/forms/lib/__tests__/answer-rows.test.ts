import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../reference-sources", () => ({
  resolveReferenceOptions: vi.fn(),
}));

import { resolveReferenceOptions } from "../reference-sources";
import {
  buildResponseGrid,
  formAnswerRows,
  formatAnswerValue,
  responsesCsvRows,
  unionResponseColumns,
} from "../answer-rows.server";
import { rowsToCsv } from "~/lib/csv";
import type { Question } from "~/types";

const mockResolve = resolveReferenceOptions as any;

function q(partial: Partial<Question> & { key: string }): Question {
  return {
    type: "text",
    required: false,
    data: { label: partial.key },
    ...partial,
  } as Question;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("formAnswerRows", () => {
  it("skips info blocks and stringifies plain answers in question order", async () => {
    const rows = await formAnswerRows(
      [
        q({ key: "a", data: { label: "Name" } }),
        q({ key: "note", type: "info", data: { label: "", body: {} } }),
        q({ key: "b", data: { label: "Count" } }),
        q({ key: "c", data: { label: "Tags" } }),
      ],
      { a: "Ada", b: 3, c: ["x", "y"] },
    );
    expect(rows).toEqual([
      { key: "a", label: "Name", value: "Ada" },
      { key: "b", label: "Count", value: "3" },
      { key: "c", label: "Tags", value: "x, y" },
    ]);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("leaves unanswered questions as empty values", async () => {
    const rows = await formAnswerRows([q({ key: "a", data: { label: "A" } })], {});
    expect(rows).toEqual([{ key: "a", label: "A", value: "" }]);
  });

  it("maps reference answers back to labels, falling back to the raw id", async () => {
    mockResolve.mockResolvedValue([{ value: "p1", label: "Project One" }]);
    const questions = [
      q({
        key: "proj",
        type: "reference",
        data: { label: "Project", referenceSource: "projects:active" },
      }),
      q({
        key: "gone",
        type: "reference",
        data: { label: "Old", referenceSource: "projects:active" },
      }),
    ];
    const rows = await formAnswerRows(questions, { proj: "p1", gone: "p9" });
    expect(rows).toEqual([
      { key: "proj", label: "Project", value: "Project One" },
      { key: "gone", label: "Old", value: "p9" },
    ]);
  });
});

describe("formatAnswerValue", () => {
  it("formats empty, array, object, and scalar answers", () => {
    const question = q({ key: "a" });
    expect(formatAnswerValue(question, null)).toBe("");
    expect(formatAnswerValue(question, "")).toBe("");
    expect(formatAnswerValue(question, ["x", "y"])).toBe("x, y");
    expect(formatAnswerValue(question, { a: 1 })).toBe('{"a":1}');
    expect(formatAnswerValue(question, 3)).toBe("3");
    expect(formatAnswerValue(question, "https://x.com/f.pdf")).toBe(
      "https://x.com/f.pdf",
    );
  });

  it("maps reference ids through the label map, falling back to the raw id", () => {
    const ref = q({
      key: "proj",
      type: "reference",
      data: { label: "Project", referenceSource: "projects:active" },
    });
    const labels = new Map([["p1", "Project One"]]);
    expect(formatAnswerValue(ref, "p1", labels)).toBe("Project One");
    expect(formatAnswerValue(ref, "p9", labels)).toBe("p9");
    expect(formatAnswerValue(ref, "p1")).toBe("p1");
  });
});

describe("unionResponseColumns", () => {
  it("orders by the newest version, appends older-only keys, and skips info", () => {
    const columns = unionResponseColumns([
      {
        versionNumber: 1,
        questions: [
          q({ key: "a", data: { label: "A old" } }),
          q({ key: "b", data: { label: "B old" } }),
        ],
      },
      {
        versionNumber: 2,
        questions: [
          q({ key: "b", data: { label: "B new" } }),
          q({ key: "note", type: "info", data: { label: "", body: {} } }),
          q({ key: "c", data: { label: "C" } }),
        ],
      },
    ]);
    expect(columns).toEqual([
      { key: "b", label: "B new" },
      { key: "c", label: "C" },
      { key: "a", label: "A old" },
    ]);
  });
});

describe("buildResponseGrid", () => {
  const refQ = (key: string, termId?: string) =>
    q({
      key,
      type: "reference",
      data: {
        label: key,
        referenceSource: "projects:active",
        referenceTermId: termId,
      },
    });

  it("resolves a shared reference source once across versions and submissions", async () => {
    mockResolve.mockResolvedValue([{ value: "p1", label: "Project One" }]);
    const v1 = { versionNumber: 1, questions: [refQ("proj")] };
    const v2 = {
      versionNumber: 2,
      questions: [refQ("proj"), q({ key: "extra", data: { label: "Extra" } })],
    };
    const grid = await buildResponseGrid([
      { formVersion: v1, answers: { proj: "p1" } },
      { formVersion: v2, answers: { proj: "p9", extra: "hi" } },
      { formVersion: v1, answers: { proj: "p1" } },
    ]);
    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(grid.rowsBySubmission[0]).toEqual([
      { key: "proj", label: "proj", value: "Project One" },
    ]);
    expect(grid.rowsBySubmission[1]).toEqual([
      { key: "proj", label: "proj", value: "p9" },
      { key: "extra", label: "Extra", value: "hi" },
    ]);
  });

  it("resolves separately per referenceTermId", async () => {
    mockResolve.mockResolvedValue([]);
    await buildResponseGrid([
      {
        formVersion: {
          versionNumber: 1,
          questions: [refQ("x", "t1"), refQ("y", "t2")],
        },
        answers: {},
      },
    ]);
    expect(mockResolve).toHaveBeenCalledTimes(2);
    expect(mockResolve).toHaveBeenCalledWith("projects:active", { termId: "t1" });
    expect(mockResolve).toHaveBeenCalledWith("projects:active", { termId: "t2" });
  });

  it("gives each submission only its own version's rows, with union columns", async () => {
    const v1 = { versionNumber: 1, questions: [q({ key: "a", data: { label: "A" } })] };
    const v2 = { versionNumber: 2, questions: [q({ key: "b", data: { label: "B" } })] };
    const grid = await buildResponseGrid([
      { formVersion: v1, answers: { a: "one" } },
      { formVersion: v2, answers: { b: "two" } },
    ]);
    expect(grid.columns).toEqual([
      { key: "b", label: "B" },
      { key: "a", label: "A" },
    ]);
    expect(grid.rowsBySubmission[0]).toEqual([{ key: "a", label: "A", value: "one" }]);
    expect(grid.rowsBySubmission[1]).toEqual([{ key: "b", label: "B", value: "two" }]);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe("responsesCsvRows", () => {
  const columns = [
    { key: "a", label: "Answer A" },
    { key: "b", label: "B" },
  ];
  const response = (rows: { key: string; label: string; value: string }[]) => ({
    name: "Ada",
    email: "ada@dali.dartmouth.edu",
    createdAt: "2026-07-14T12:00:00.000Z",
    versionNumber: 2,
    slot: null,
    rows,
  });

  it("composes meta + question headers, with Slot only when included", () => {
    const [header] = responsesCsvRows(columns, [], { includeSlot: false });
    expect(header).toEqual(["Name", "Email", "Submitted at", "Version", "Answer A", "B"]);
    const [slotHeader] = responsesCsvRows(columns, [], { includeSlot: true });
    expect(slotHeader).toEqual([
      "Name", "Email", "Submitted at", "Version", "Slot", "Answer A", "B",
    ]);
  });

  it("leaves cells empty for keys a submission's version never asked", () => {
    const [, row] = responsesCsvRows(
      columns,
      [response([{ key: "b", label: "B", value: "only b" }])],
      { includeSlot: false },
    );
    expect(row).toEqual([
      "Ada", "ada@dali.dartmouth.edu", "2026-07-14T12:00:00.000Z", "2", "", "only b",
    ]);
  });

  it("survives commas, quotes, and newlines through rowsToCsv", () => {
    const csv = rowsToCsv(
      responsesCsvRows(
        columns,
        [
          response([
            { key: "a", label: "Answer A", value: "a,b" },
            { key: "b", label: "B", value: 'He said "hi"\nthen left' },
          ]),
        ],
        { includeSlot: false },
      ),
    );
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"He said ""hi""\nthen left"');
  });
});
