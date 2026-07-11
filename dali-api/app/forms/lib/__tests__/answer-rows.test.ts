import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../reference-sources", () => ({
  resolveReferenceOptions: vi.fn(),
}));

import { resolveReferenceOptions } from "../reference-sources";
import { formAnswerRows } from "../answer-rows.server";
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
