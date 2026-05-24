import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { Prisma } from "~/generated/prisma/client";
import { runFormsAction } from "~/forms/lib/forms-data";

const mockPrisma = prisma as unknown as {
  form: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  formVersion: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

// Build a FormData the way the editor's submit() does.
function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const ONE_QUESTION = JSON.stringify([
  { key: "q1", type: "text", required: false, data: { label: "Name" } },
]);

beforeEach(() => {
  vi.clearAllMocks();
  // The array form of $transaction just needs to resolve.
  mockPrisma.$transaction.mockResolvedValue([]);
});

describe("runFormsAction save-draft", () => {
  it("persists the working copy to the Form, not a FormVersion", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });

    const res = await runFormsAction(
      fd({ intent: "save-draft", id: "form-1", questions: ONE_QUESTION, description: "" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: { draftQuestions: expect.any(Array), draftIntro: null },
    });
    // A draft must NOT create a version.
    expect(mockPrisma.formVersion.create).not.toHaveBeenCalled();
  });

  it("accepts a half-finished draft (no label) — leniency is the point", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    const draftish = JSON.stringify([
      { key: "q1", type: "text", required: false, data: { label: "" } },
    ]);

    const res = await runFormsAction(
      fd({ intent: "save-draft", id: "form-1", questions: draftish }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.form.update).toHaveBeenCalled();
  });

  it("404s when the form is missing", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(null);

    const res = await runFormsAction(
      fd({ intent: "save-draft", id: "nope", questions: ONE_QUESTION }),
      "user-1",
    );

    expect(res).toEqual({ error: "Not found", status: 404 });
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });
});

describe("runFormsAction save-version", () => {
  it("freezes a version and clears the draft in one transaction", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    mockPrisma.formVersion.findFirst.mockResolvedValue({ versionNumber: 2 });

    const res = await runFormsAction(
      fd({ intent: "save-version", id: "form-1", questions: ONE_QUESTION, description: "" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    // Both the version create and the draft clear go through $transaction.
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();

    // The version create is numbered after the latest (2 → 3).
    expect(mockPrisma.formVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ formId: "form-1", versionNumber: 3 }),
      }),
    );
    // The draft is nulled out (JSON column → Prisma.DbNull).
    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: { draftQuestions: Prisma.DbNull, draftIntro: null },
    });
  });

  it("rejects a version with no questions (validation still enforced)", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });

    const res = await runFormsAction(
      fd({ intent: "save-version", id: "form-1", questions: "[]" }),
      "user-1",
    );

    expect(res).toEqual({ error: "Add at least one valid question.", status: 400 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a version whose question has no label", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    const noLabel = JSON.stringify([
      { key: "q1", type: "text", required: false, data: { label: "  " } },
    ]);

    const res = await runFormsAction(
      fd({ intent: "save-version", id: "form-1", questions: noLabel }),
      "user-1",
    );

    expect(res).toEqual({ error: "Every question needs a label.", status: 400 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
