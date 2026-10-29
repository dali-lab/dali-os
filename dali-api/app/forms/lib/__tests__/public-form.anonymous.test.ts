import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/forms/lib/submission-notify.server", () => ({
  notifyFormSubmission: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/forms/lib/form-access.server", () => ({ fillAccessByPage: vi.fn() }));

import { prisma } from "~/lib/db";
import { fillAccessByPage } from "~/forms/lib/form-access.server";
import { submitAnonymousForm } from "~/forms/lib/public-form";
import { notifyFormSubmission } from "~/forms/lib/submission-notify.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockNotify = notifyFormSubmission as ReturnType<typeof vi.fn>;
const mockFillAccess = fillAccessByPage as ReturnType<typeof vi.fn>;

const QUESTIONS = [
  { key: "q1", type: "textarea", required: true, data: { label: "Feedback" } },
];

function formRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "form-1",
    published: true,
    versions: [{ id: "ver-1", questions: QUESTIONS }],
    ...overrides,
  };
}

function submit(overrides: Record<string, unknown> = {}) {
  return submitAnonymousForm({
    token: "tok",
    versionId: "ver-1",
    answers: { q1: "hello" },
    submitterIp: "1.2.3.4",
    ...overrides,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockNotify.mockResolvedValue(undefined);
  mockFillAccess.mockResolvedValue("ok");
  mockPrisma.form.findUnique.mockResolvedValue(formRow());
  mockPrisma.formSubmission.create.mockResolvedValue({ id: "sub-1" });
});

describe("submitAnonymousForm", () => {
  it("records an unattributed row with the client IP and notifies", async () => {
    const result = await submit();

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalledWith({
      data: {
        formId: "form-1",
        formVersionId: "ver-1",
        userId: null,
        answers: { q1: "hello" },
        submitterIp: "1.2.3.4",
      },
    });
    expect(mockNotify).toHaveBeenCalledWith({ formId: "form-1" });
    // None of the member-path side effects.
    expect(mockPrisma.notification.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.formSubmission.findFirst).not.toHaveBeenCalled();
  });

  it("accepts a form whose page is Public even when Form.audience is Members", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(formRow({ audience: "Members" }));
    expect(await submit()).toEqual({ ok: true });
    expect(mockFillAccess).toHaveBeenCalledWith("form-1", null);
    expect(mockPrisma.formSubmission.create).toHaveBeenCalled();
  });

  it("accepts a Public page when the form has no audience selected", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(formRow({ audience: null }));
    expect(await submit()).toEqual({ ok: true });
  });

  it.each(["login", "denied"])("403s a page that is not Public (%s) and writes nothing", async (decision) => {
    mockFillAccess.mockResolvedValue(decision);
    const result = await submit();
    expect(result).toEqual({ error: "This form requires signing in.", status: 403 });
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("404s an unknown or unpublished form", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(null);
    expect(await submit()).toMatchObject({ status: 404 });

    mockPrisma.form.findUnique.mockResolvedValue(formRow({ published: false }));
    expect(await submit()).toMatchObject({ status: 404 });
  });

  it("falls back to the latest version when the submitted id is stale", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(formRow({ versions: [] }));
    mockPrisma.formVersion.findFirst.mockResolvedValue({
      id: "ver-2",
      questions: QUESTIONS,
    });

    const result = await submit({ versionId: "ver-stale" });

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ formVersionId: "ver-2" }),
      }),
    );
  });

  it("passes validation errors through without writing", async () => {
    const result = await submit({ answers: {} }); // q1 required

    expect(result).toMatchObject({ status: 400 });
    expect(result).toHaveProperty("error", '"Feedback" is required.');
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
  });

  // The version an unused form serves can be edited in place between load and
  // submit; a filler that sends the fingerprint it loaded is protected.
  const STAMP = "2026-08-15T12:00:00.000Z";

  it("records the submit when the fingerprint still matches", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({ versions: [{ id: "ver-1", questions: QUESTIONS, updatedAt: new Date(STAMP) }] }),
    );

    const result = await submit({ versionUpdatedAt: STAMP });

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create).toHaveBeenCalled();
  });

  it("409s a stale fingerprint (version edited under the filler)", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow({
        versions: [
          { id: "ver-1", questions: QUESTIONS, updatedAt: new Date("2026-08-15T13:00:00.000Z") },
        ],
      }),
    );

    const result = await submit({ versionUpdatedAt: STAMP });

    expect(result).toMatchObject({ status: 409 });
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
  });

  it("409s when the loaded version was deleted (fingerprint present, id gone)", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(formRow({ versions: [] }));

    const result = await submit({ versionId: "ver-gone", versionUpdatedAt: STAMP });

    expect(result).toMatchObject({ status: 409 });
    expect(mockPrisma.formSubmission.create).not.toHaveBeenCalled();
  });
});
