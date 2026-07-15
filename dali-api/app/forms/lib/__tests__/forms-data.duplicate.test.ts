import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { runFormsAction } from "~/forms/lib/forms-data";

const mockPrisma = prisma as unknown as {
  form: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const DRAFT_QUESTIONS = [
  { key: "d1", type: "text", required: false, data: { label: "Draft Q" } },
];
const VERSION_QUESTIONS = [
  { key: "v1", type: "text", required: false, data: { label: "Version Q" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.form.create.mockResolvedValue({ id: "copy-1" });
});

describe("runFormsAction duplicate-form", () => {
  it("copies the draft (when present) into a new form's draft and returns its id", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({
      name: "Snack Poll",
      folderId: "folder-1",
      draftQuestions: DRAFT_QUESTIONS,
      draftIntro: "draft intro",
      versions: [{ questions: VERSION_QUESTIONS, intro: "version intro" }],
    });

    const res = await runFormsAction(
      fd({ intent: "duplicate-form", id: "form-1" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true, formId: "copy-1" });
    expect(mockPrisma.form.create).toHaveBeenCalledWith({
      data: {
        name: "Copy of Snack Poll",
        folderId: "folder-1",
        createdById: "user-1",
        draftQuestions: DRAFT_QUESTIONS,
        draftIntro: "draft intro",
      },
      select: { id: true },
    });
  });

  it("falls back to the latest version when there is no draft", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({
      name: "Snack Poll",
      folderId: null,
      draftQuestions: null,
      draftIntro: null,
      versions: [{ questions: VERSION_QUESTIONS, intro: "version intro" }],
    });

    const res = await runFormsAction(
      fd({ intent: "duplicate-form", id: "form-1" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true, formId: "copy-1" });
    expect(mockPrisma.form.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          draftQuestions: VERSION_QUESTIONS,
          draftIntro: "version intro",
        }),
      }),
    );
  });

  it("copies an empty form as an empty draft", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({
      name: "Blank",
      folderId: null,
      draftQuestions: null,
      draftIntro: null,
      versions: [],
    });

    const res = await runFormsAction(
      fd({ intent: "duplicate-form", id: "form-1" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true, formId: "copy-1" });
    const data = mockPrisma.form.create.mock.calls[0][0].data;
    expect(data.draftQuestions).toBeUndefined();
  });

  it("never copies publish/listing/audience state — the copy uses column defaults", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({
      name: "Live Form",
      folderId: null,
      draftQuestions: DRAFT_QUESTIONS,
      draftIntro: null,
      versions: [],
    });

    await runFormsAction(fd({ intent: "duplicate-form", id: "form-1" }), "user-1");

    const data = mockPrisma.form.create.mock.calls[0][0].data;
    for (const key of [
      "published",
      "publicToken",
      "listed",
      "audience",
      "audienceGroupIds",
      "oneResponsePerMember",
      "notifyOnSubmission",
    ]) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it("404s an unknown source form", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(null);
    const res = await runFormsAction(
      fd({ intent: "duplicate-form", id: "ghost" }),
      "user-1",
    );
    expect(res).toEqual({ error: "Not found", status: 404 });
    expect(mockPrisma.form.create).not.toHaveBeenCalled();
  });
});
