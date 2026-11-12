import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/form-page.server", () => ({
  createForm: vi.fn(),
  renameForm: vi.fn(),
  moveForm: vi.fn(),
  deleteForm: vi.fn(),
  setFormAudience: vi.fn(),
  setFormArchived: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { runFormsAction, validateVersionQuestions } from "~/forms/lib/forms-data";
import { createForm } from "~/forms/lib/form-page.server";
import type { Question } from "~/types";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const q = (
  key: string,
  type: Question["type"],
  data: Partial<Question["data"]> = {},
): Question => ({ key, type, required: false, data: { label: key, ...data } });
const rule = (questionKey: string, op: "is" | "isNot" | "includes" | "excludes", value: string) => ({
  showIf: { questionKey, op, value },
});

const dropdown = q("returning", "select", { options: ["Yes", "No"] });
const saveVersion = (questions: unknown[]) =>
  runFormsAction(
    fd({ intent: "save-version", id: "form-1", questions: JSON.stringify(questions) }),
    "user-1",
  );
const updateVersion = (questions: unknown[]) =>
  runFormsAction(
    fd({
      intent: "update-version",
      id: "form-1",
      versionId: "ver-1",
      questions: JSON.stringify(questions),
    }),
    "user-1",
  );

beforeEach(() => {
  vi.clearAllMocks();
  db.form.findUnique.mockResolvedValue({ id: "form-1", publicToken: null });
  db.formVersion.findFirst.mockResolvedValue({ versionNumber: 1 });
  db.formVersion.findUnique.mockResolvedValue({ id: "ver-1", formId: "form-1", form: { publicToken: null } });
  db.formSubmission.findFirst.mockResolvedValue(null);
  db.application.findFirst.mockResolvedValue(null);
  db.domainApplication.findFirst.mockResolvedValue(null);
  db.staffingCycleFormBinding.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : [],
  );
});

describe.each([
  ["save-version", saveVersion],
  ["update-version", updateVersion],
])("%s with rules", (_name, save) => {
  it("accepts a valid rule", async () => {
    expect(await save([dropdown, q("why", "textarea", rule("returning", "is", "No"))])).toEqual({ ok: true });
  });

  it("accepts a form without rules exactly as before", async () => {
    expect(await save([q("a", "text")])).toEqual({ ok: true });
  });

  it("rejects a deleted source, naming the question", async () => {
    const res = await save([q("why", "textarea", rule("gone", "is", "No"))]);
    expect(res).toEqual({ error: '"why" depends on a question that was deleted.', status: 400 });
  });

  it("rejects a source that now comes after the question", async () => {
    const res = await save([q("why", "textarea", rule("returning", "is", "No")), dropdown]);
    expect(res).toMatchObject({ status: 400, error: expect.stringContaining("comes after") });
  });

  it("rejects a source of a type that cannot be a source", async () => {
    const res = await save([q("a", "skills_rating"), q("why", "textarea", rule("a", "is", "x"))]);
    expect(res).toMatchObject({ status: 400, error: expect.stringContaining("can't be used in a condition") });
  });

  it("rejects an option that was renamed or removed", async () => {
    const res = await save([dropdown, q("why", "textarea", rule("returning", "is", "Maybe"))]);
    expect(res).toMatchObject({ status: 400, error: expect.stringContaining("no longer an option") });
  });

  it("rejects an operator that does not fit the source", async () => {
    const res = await save([dropdown, q("why", "textarea", rule("returning", "includes", "No"))]);
    expect(res).toMatchObject({ status: 400, error: expect.stringContaining("doesn't fit") });
  });

  it("saves a rule on a page break and rules with several conditions", async () => {
    const res = await save([
      dropdown,
      q("score", "scale"),
      q("pb", "pageBreak", rule("returning", "is", "No")),
      q("why", "textarea", {
        showIf: {
          match: "any",
          conditions: [
            { questionKey: "returning", op: "is", values: ["Yes", "No"] },
            { questionKey: "score", op: "atMost", values: ["2"] },
          ],
        },
      }),
    ]);
    expect(res).toEqual({ ok: true });
  });

  it("rejects a page rule when the mapping reads a question on that page", async () => {
    db.staffingCycleFormBinding.findMany.mockResolvedValue([
      {
        slot: "level-up",
        columnMapping: {
          version: 1,
          entries: [{ role: "display", label: "Why", source: "question", questionKey: "why" }],
        },
      },
    ]);
    const res = await save([
      dropdown,
      q("pb", "pageBreak", { label: "More", ...rule("returning", "is", "No") }),
      q("why", "textarea"),
    ]);
    expect(res).toMatchObject({ status: 400, error: expect.stringContaining("on its page is used by Level Up") });
  });

  it("rejects a question mapped on any binding, whatever its slot", async () => {
    for (const slot of ["project-bids", "intent-to-work", "level-up"]) {
      db.staffingCycleFormBinding.findMany.mockResolvedValue([
        {
          slot,
          columnMapping: {
            version: 1,
            entries: [{ role: "display", label: "Why", source: "question", questionKey: "why" }],
          },
        },
      ]);
      const res = await save([dropdown, q("why", "textarea", rule("returning", "is", "No"))]);
      expect(res).toMatchObject({ status: 400, error: expect.stringContaining("always has to be shown") });
    }
    expect(db.staffingCycleFormBinding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { formId: "form-1" } }),
    );
  });

  it("allows a rule on a question the mapping does not read", async () => {
    db.staffingCycleFormBinding.findMany.mockResolvedValue([
      {
        slot: "level-up",
        columnMapping: {
          version: 1,
          entries: [{ role: "display", label: "Other", source: "question", questionKey: "other" }],
        },
      },
    ]);
    expect(await save([dropdown, q("why", "textarea", rule("returning", "is", "No"))])).toEqual({ ok: true });
  });
});

describe("validateVersionQuestions", () => {
  it("takes the mapped questions as an argument", () => {
    const raw = JSON.stringify([dropdown, q("why", "textarea", rule("returning", "is", "No"))]);
    expect(validateVersionQuestions(raw)).toMatchObject({ ok: true });
    expect(validateVersionQuestions(raw, new Map([["why", "Level Up"]]))).toMatchObject({ status: 400 });
  });
});

describe("duplicate-form", () => {
  const withRule = [dropdown, q("why", "textarea", rule("returning", "is", "No"))];

  it("keeps rules when copying a draft", async () => {
    vi.mocked(createForm).mockResolvedValue({ id: "copy-1" } as never);
    db.form.findUnique.mockResolvedValue({
      name: "Check-in",
      folderPageId: null,
      draftQuestions: withRule,
      draftIntro: null,
      versions: [],
    });
    await runFormsAction(fd({ intent: "duplicate-form", id: "form-1" }), "user-1");
    expect(vi.mocked(createForm).mock.calls[0][0].draftQuestions).toEqual(withRule);
  });

  it("keeps rules when copying the latest version, and the copy validates", async () => {
    vi.mocked(createForm).mockResolvedValue({ id: "copy-1" } as never);
    db.form.findUnique.mockResolvedValue({
      name: "Check-in",
      folderPageId: null,
      draftQuestions: null,
      draftIntro: null,
      versions: [{ questions: withRule, intro: null }],
    });
    await runFormsAction(fd({ intent: "duplicate-form", id: "form-1" }), "user-1");
    const copied = vi.mocked(createForm).mock.calls[0][0].draftQuestions as Question[];
    expect(copied.map((x) => x.data.showIf)).toEqual([undefined, withRule[1].data.showIf]);
    expect(validateVersionQuestions(JSON.stringify(copied))).toMatchObject({ ok: true });
  });
});
