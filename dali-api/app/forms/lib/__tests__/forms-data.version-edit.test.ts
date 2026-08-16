import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { runFormsAction } from "~/forms/lib/forms-data";

const mockPrisma = prisma as unknown as {
  formVersion: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  formSubmission: { findFirst: ReturnType<typeof vi.fn> };
  application: { findFirst: ReturnType<typeof vi.fn> };
  domainApplication: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const ONE_QUESTION = JSON.stringify([
  { key: "q1", type: "text", required: false, data: { label: "Name" } },
]);

// The lock check runs three findFirst queries; default them all to "unused".
function markUnused() {
  mockPrisma.formSubmission.findFirst.mockResolvedValue(null);
  mockPrisma.application.findFirst.mockResolvedValue(null);
  mockPrisma.domainApplication.findFirst.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Run the interactive transaction callback against a tx that proxies the
  // formVersion writes so assertions can see them.
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
});

describe("runFormsAction update-version", () => {
  it("edits an unused version in place — no new version row", async () => {
    mockPrisma.formVersion.findUnique.mockResolvedValue({ id: "ver-1", formId: "form-1" });
    markUnused();

    const res = await runFormsAction(
      fd({ intent: "update-version", id: "form-1", versionId: "ver-1", questions: ONE_QUESTION, description: "" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.formVersion.update).toHaveBeenCalledWith({
      where: { id: "ver-1" },
      data: { questions: expect.any(Array), intro: null },
    });
  });

  it("404s when the version doesn't belong to the form", async () => {
    mockPrisma.formVersion.findUnique.mockResolvedValue({ id: "ver-1", formId: "other-form" });

    const res = await runFormsAction(
      fd({ intent: "update-version", id: "form-1", versionId: "ver-1", questions: ONE_QUESTION }),
      "user-1",
    );

    expect(res).toEqual({ error: "Version not found", status: 404 });
    expect(mockPrisma.formVersion.update).not.toHaveBeenCalled();
  });

  it("still enforces version validation (no label)", async () => {
    mockPrisma.formVersion.findUnique.mockResolvedValue({ id: "ver-1", formId: "form-1" });
    const noLabel = JSON.stringify([
      { key: "q1", type: "text", required: false, data: { label: "  " } },
    ]);

    const res = await runFormsAction(
      fd({ intent: "update-version", id: "form-1", versionId: "ver-1", questions: noLabel }),
      "user-1",
    );

    expect(res).toEqual({ error: "Every question needs a label.", status: 400 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["a submission", "formSubmission"],
    ["a pinned hiring application", "application"],
    ["a pinned domain challenge", "domainApplication"],
  ] as const)("409s when the version is locked by %s", async (_label, table) => {
    mockPrisma.formVersion.findUnique.mockResolvedValue({ id: "ver-1", formId: "form-1" });
    markUnused();
    mockPrisma[table].findFirst.mockResolvedValue({ id: "x" });

    const res = await runFormsAction(
      fd({ intent: "update-version", id: "form-1", versionId: "ver-1", questions: ONE_QUESTION }),
      "user-1",
    );

    expect(res).toMatchObject({ status: 409 });
    expect(mockPrisma.formVersion.update).not.toHaveBeenCalled();
  });
});

describe("runFormsAction delete-version", () => {
  it("removes an unused version", async () => {
    mockPrisma.formVersion.findUnique.mockResolvedValue({ id: "ver-1", formId: "form-1" });
    markUnused();

    const res = await runFormsAction(
      fd({ intent: "delete-version", id: "form-1", versionId: "ver-1" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.formVersion.delete).toHaveBeenCalledWith({ where: { id: "ver-1" } });
  });

  it("409s when the version already has a response", async () => {
    mockPrisma.formVersion.findUnique.mockResolvedValue({ id: "ver-1", formId: "form-1" });
    markUnused();
    mockPrisma.formSubmission.findFirst.mockResolvedValue({ id: "sub-1" });

    const res = await runFormsAction(
      fd({ intent: "delete-version", id: "form-1", versionId: "ver-1" }),
      "user-1",
    );

    expect(res).toMatchObject({ status: 409 });
    expect(mockPrisma.formVersion.delete).not.toHaveBeenCalled();
  });
});
