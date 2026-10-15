import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/forms/lib/form-page.server", () => ({
  createForm: vi.fn(),
  renameForm: vi.fn(),
  moveForm: vi.fn(),
  deleteForm: vi.fn(),
  setFormAudience: vi.fn(),
  setFormArchived: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { runFormsAction } from "~/forms/lib/forms-data";
import { createForm } from "~/forms/lib/form-page.server";

const mockPrisma = prisma as unknown as {
  form: {
    findUnique: ReturnType<typeof vi.fn>;
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
  vi.mocked(createForm).mockResolvedValue({ id: "copy-1" } as never);
});

describe("runFormsAction duplicate-form", () => {
  it("copies the draft (when present) into a new form's draft and returns its id", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({
      name: "Snack Poll",
      folderPageId: "folder-1",
      draftQuestions: DRAFT_QUESTIONS,
      draftIntro: "draft intro",
      versions: [{ questions: VERSION_QUESTIONS, intro: "version intro" }],
    });

    const res = await runFormsAction(
      fd({ intent: "duplicate-form", id: "form-1" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true, formId: "copy-1" });
    expect(createForm).toHaveBeenCalledWith(
      {
        name: "Copy of Snack Poll",
        folderPageId: "folder-1",
        createdById: "user-1",
        draftQuestions: DRAFT_QUESTIONS,
        draftIntro: "draft intro",
      },
      { id: true },
    );
  });

  it("falls back to the latest version when there is no draft", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({
      name: "Snack Poll",
      folderPageId: null,
      draftQuestions: null,
      draftIntro: null,
      versions: [{ questions: VERSION_QUESTIONS, intro: "version intro" }],
    });

    const res = await runFormsAction(
      fd({ intent: "duplicate-form", id: "form-1" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true, formId: "copy-1" });
    expect(createForm).toHaveBeenCalledWith(
      expect.objectContaining({ draftQuestions: VERSION_QUESTIONS, draftIntro: "version intro" }),
      { id: true },
    );
  });

  it("copies an empty form as an empty draft", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({
      name: "Blank",
      folderPageId: null,
      draftQuestions: null,
      draftIntro: null,
      versions: [],
    });

    const res = await runFormsAction(
      fd({ intent: "duplicate-form", id: "form-1" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true, formId: "copy-1" });
    const data = vi.mocked(createForm).mock.calls[0][0];
    expect(data.draftQuestions).toBeUndefined();
  });

  it("never copies publish/listing/audience state — the copy uses column defaults", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({
      name: "Live Form",
      folderPageId: null,
      draftQuestions: DRAFT_QUESTIONS,
      draftIntro: null,
      versions: [],
    });

    await runFormsAction(fd({ intent: "duplicate-form", id: "form-1" }), "user-1");

    const data = vi.mocked(createForm).mock.calls[0][0];
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
    expect(createForm).not.toHaveBeenCalled();
  });
});
