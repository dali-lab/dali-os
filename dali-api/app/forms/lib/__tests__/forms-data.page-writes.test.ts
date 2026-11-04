import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/form-page.server", () => ({
  createForm: vi.fn(),
  renameForm: vi.fn(),
  moveForm: vi.fn(),
  deleteForm: vi.fn(),
  setFormAudience: vi.fn(),
  setFormArchived: vi.fn(),
  setFormIcon: vi.fn(),
}));
vi.mock("~/forms/lib/form-usages.server", () => ({
  formDeletionBlockers: vi.fn(),
  formUsages: vi.fn(),
  managingUsage: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { runFormsAction } from "~/forms/lib/forms-data";
import { createForm, deleteForm, renameForm, setFormIcon } from "~/forms/lib/form-page.server";
import { formDeletionBlockers, formUsages, managingUsage } from "~/forms/lib/form-usages.server";

const mockPrisma = prisma as unknown as {
  form: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  page: { findFirst: ReturnType<typeof vi.fn> };
};

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(formUsages).mockResolvedValue([]);
  vi.mocked(managingUsage).mockReturnValue(null as never);
  vi.mocked(formDeletionBlockers).mockResolvedValue([]);
  mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
});

describe("runFormsAction create-form", () => {
  it("creates the form and its page through the shared helper, not prisma.form.create", async () => {
    mockPrisma.page.findFirst.mockResolvedValue({ id: "folder-1" });
    vi.mocked(createForm).mockResolvedValue({ id: "new-1" } as never);

    const res = await runFormsAction(
      fd({ intent: "create-form", name: "Intake", folderPageId: "folder-1" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true, formId: "new-1" });
    expect(createForm).toHaveBeenCalledWith(
      { name: "Intake", folderPageId: "folder-1", createdById: "user-1" },
      { id: true },
    );
    expect(mockPrisma.form.create).not.toHaveBeenCalled();
  });

  it("404s a missing folder without creating anything", async () => {
    mockPrisma.page.findFirst.mockResolvedValue(null);
    const res = await runFormsAction(
      fd({ intent: "create-form", name: "Intake", folderPageId: "ghost" }),
      "user-1",
    );
    expect(res).toEqual({ error: "Folder not found", status: 404 });
    expect(createForm).not.toHaveBeenCalled();
  });
});

describe("runFormsAction rename-form", () => {
  it("renames through the helper so the page title follows", async () => {
    const res = await runFormsAction(fd({ intent: "rename-form", id: "form-1", name: "Renamed" }), "user-1");
    expect(res).toEqual({ ok: true });
    expect(renameForm).toHaveBeenCalledWith("form-1", "Renamed");
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });

  it("404s an unknown form", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(null);
    const res = await runFormsAction(fd({ intent: "rename-form", id: "ghost", name: "x" }), "user-1");
    expect(res).toEqual({ error: "Not found", status: 404 });
    expect(renameForm).not.toHaveBeenCalled();
  });
});

describe("runFormsAction set-form-icon", () => {
  it("sets the icon on the form's page", async () => {
    const res = await runFormsAction(fd({ intent: "set-form-icon", id: "form-1", iconEmoji: "📋" }), "user-1");
    expect(res).toEqual({ ok: true });
    expect(setFormIcon).toHaveBeenCalledWith("form-1", "📋");
  });

  it("clears the icon on an empty value", async () => {
    const res = await runFormsAction(fd({ intent: "set-form-icon", id: "form-1", iconEmoji: "  " }), "user-1");
    expect(res).toEqual({ ok: true });
    expect(setFormIcon).toHaveBeenCalledWith("form-1", null);
  });

  it("rejects an icon longer than the reaction emoji limit", async () => {
    const res = await runFormsAction(fd({ intent: "set-form-icon", id: "form-1", iconEmoji: "x".repeat(65) }), "user-1");
    expect(res).toEqual({ error: "Invalid input", status: 400 });
    expect(setFormIcon).not.toHaveBeenCalled();
  });

  it("404s an unknown form", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(null);
    const res = await runFormsAction(fd({ intent: "set-form-icon", id: "ghost", iconEmoji: "📋" }), "user-1");
    expect(res).toEqual({ error: "Not found", status: 404 });
    expect(setFormIcon).not.toHaveBeenCalled();
  });
});

describe("runFormsAction delete-form", () => {
  it("deletes through the helper when nothing depends on the form", async () => {
    const res = await runFormsAction(fd({ intent: "delete-form", id: "form-1" }), "user-1");
    expect(res).toEqual({ ok: true });
    expect(deleteForm).toHaveBeenCalledWith("form-1");
  });

  it("refuses with a 409 while a live surface depends on the form", async () => {
    vi.mocked(formDeletionBlockers).mockResolvedValue(["the 26F application"]);
    const res = await runFormsAction(fd({ intent: "delete-form", id: "form-1" }), "user-1");
    expect(res).toMatchObject({ status: 409 });
    expect(deleteForm).not.toHaveBeenCalled();
  });

  it("404s an unknown form", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(null);
    const res = await runFormsAction(fd({ intent: "delete-form", id: "ghost" }), "user-1");
    expect(res).toEqual({ error: "Not found", status: 404 });
    expect(deleteForm).not.toHaveBeenCalled();
  });
});
