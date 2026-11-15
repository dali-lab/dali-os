import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { formSubmission: { findMany: vi.fn() }, $queryRawUnsafe: vi.fn() },
}));
vi.mock("~/forms/lib/answer-rows.server", () => ({
  buildReferenceLabelMaps: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { buildReferenceLabelMaps } from "~/forms/lib/answer-rows.server";
import { loadVersionSummary } from "~/forms/lib/version-summary.server";
import type { Question } from "~/types";

const findMany = (prisma as unknown as { formSubmission: { findMany: ReturnType<typeof vi.fn> } })
  .formSubmission.findMany;

const questions: Question[] = [
  { key: "a", type: "select", required: false, data: { label: "Pick", options: ["Yes", "No"] } },
  { key: "r", type: "reference", required: false, data: { label: "Project", referenceSource: "projects" } },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(buildReferenceLabelMaps).mockResolvedValue(new Map([["r", new Map([["p1", "Alpha"]])]]));
});

function stub(answers: unknown[], slots: string[] = []) {
  findMany.mockImplementation(async (args: { distinct?: string[] }) =>
    args.distinct ? slots.map((slot) => ({ slot })) : answers.map((a) => ({ answers: a })),
  );
}

describe("loadVersionSummary", () => {
  it("reads only the answers column for every submission, unpaged", async () => {
    stub([{ a: "Yes" }]);
    await loadVersionSummary("f1", { id: "v1", questions });
    const call = findMany.mock.calls.find(([a]) => !a.distinct)![0];
    expect(call.select).toEqual({ answers: true });
    expect(call.where).toEqual({ formId: "f1", formVersionId: "v1" });
    expect(call.take).toBeUndefined();
    expect(call.skip).toBeUndefined();
  });

  it("applies the slot filter, including a specific slot, to the counted answers", async () => {
    stub([{ a: "Yes" }]);
    await loadVersionSummary("f1", { id: "v1", questions }, { slot: "level-up" });
    const call = findMany.mock.calls.find(([a]) => !a.distinct)![0];
    expect(call.where).toEqual({ formId: "f1", formVersionId: "v1", slot: "level-up" });
  });

  it("offers every slot in the version regardless of the filter", async () => {
    stub([], ["level-up", "Tue 3pm"]);
    const out = await loadVersionSummary("f1", { id: "v1", questions }, { slot: "Tue 3pm" });
    const slotCall = findMany.mock.calls.find(([a]) => a.distinct)![0];
    expect(slotCall.where).toEqual({ formId: "f1", formVersionId: "v1", slot: { not: null } });
    expect(out.slotOptions).toEqual(["level-up", "Tue 3pm"]);
  });

  it("summarizes with reference labels", async () => {
    stub([{ a: "Yes", r: "p1" }, { a: "No", r: "p1" }, {}]);
    const out = await loadVersionSummary("f1", { id: "v1", questions });
    expect(out.versionId).toBe("v1");
    expect(out.summary.total).toBe(3);
    const ref = out.summary.questions[1];
    expect(ref).toMatchObject({ kind: "choice", bars: [{ label: "Alpha", count: 2 }] });
  });

  it("counts only the submissions the answer filters matched, and ignores no search", async () => {
    stub([{ a: "Yes" }]);
    (prisma as unknown as { $queryRawUnsafe: ReturnType<typeof vi.fn> }).$queryRawUnsafe.mockResolvedValue([{ id: "s1" }]);
    const out = await loadVersionSummary(
      "f1",
      { id: "v1", questions },
      { answers: [{ key: "a", kind: "is", values: ["Yes"] }] },
    );
    const call = findMany.mock.calls.find(([a]) => !a.distinct)![0];
    expect(call.where).toEqual({ formId: "f1", formVersionId: "v1", id: { in: ["s1"] } });
    expect(out.filterQuestions.map((f) => f.key)).toEqual(["a", "r"]);
    expect(out.filterQuestions[1].options).toEqual([{ value: "p1", label: "Alpha" }]);
  });
});
