import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { runFormsAction } from "~/forms/lib/forms-data";

const mockPrisma = prisma as unknown as {
  form: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  formFolder: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runFormsAction move-form", () => {
  it("moves a form to the top level without looking up a folder", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });

    const res = await runFormsAction(
      fd({ intent: "move-form", id: "form-1", folderId: "" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: { folderId: null },
    });
    // "" short-circuits resolveFolderId — no folder existence query.
    expect(mockPrisma.formFolder.findUnique).not.toHaveBeenCalled();
  });

  it("moves a form into an existing folder", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    mockPrisma.formFolder.findUnique.mockResolvedValue({ id: "folder-1" });

    const res = await runFormsAction(
      fd({ intent: "move-form", id: "form-1", folderId: "folder-1" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: { folderId: "folder-1" },
    });
  });

  it("404s when the destination folder is gone", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    mockPrisma.formFolder.findUnique.mockResolvedValue(null);

    const res = await runFormsAction(
      fd({ intent: "move-form", id: "form-1", folderId: "ghost" }),
      "user-1",
    );

    expect(res).toEqual({ error: "Folder not found", status: 404 });
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });

  it("404s when the form is gone", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(null);

    const res = await runFormsAction(
      fd({ intent: "move-form", id: "ghost", folderId: "" }),
      "user-1",
    );

    expect(res).toEqual({ error: "Not found", status: 404 });
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });
});

describe("runFormsAction move-folder", () => {
  it("moves a folder to the top level without a cycle check", async () => {
    mockPrisma.formFolder.findUnique.mockResolvedValue({ id: "A" });

    const res = await runFormsAction(
      fd({ intent: "move-folder", id: "A", parentId: "" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.formFolder.update).toHaveBeenCalledWith({
      where: { id: "A" },
      data: { parentId: null },
    });
    // Null target can't create a cycle — the tree walk is skipped.
    expect(mockPrisma.formFolder.findMany).not.toHaveBeenCalled();
  });

  it("nests a folder under an unrelated folder", async () => {
    mockPrisma.formFolder.findUnique
      .mockResolvedValueOnce({ id: "A" }) // the folder being moved
      .mockResolvedValueOnce({ id: "B" }); // the target parent
    mockPrisma.formFolder.findMany.mockResolvedValue([
      { id: "A", parentId: null },
      { id: "B", parentId: null },
    ]);

    const res = await runFormsAction(
      fd({ intent: "move-folder", id: "A", parentId: "B" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.formFolder.update).toHaveBeenCalledWith({
      where: { id: "A" },
      data: { parentId: "B" },
    });
  });

  it("400s when moving a folder under its own grandchild", async () => {
    mockPrisma.formFolder.findUnique
      .mockResolvedValueOnce({ id: "A" })
      .mockResolvedValueOnce({ id: "C" });
    mockPrisma.formFolder.findMany.mockResolvedValue([
      { id: "A", parentId: null },
      { id: "B", parentId: "A" },
      { id: "C", parentId: "B" },
    ]);

    const res = await runFormsAction(
      fd({ intent: "move-folder", id: "A", parentId: "C" }),
      "user-1",
    );

    expect(res).toEqual({
      error: "Can't move a folder into itself or its own subfolder.",
      status: 400,
    });
    expect(mockPrisma.formFolder.update).not.toHaveBeenCalled();
  });

  it("400s when moving a folder into itself, before walking the tree", async () => {
    mockPrisma.formFolder.findUnique
      .mockResolvedValueOnce({ id: "A" })
      .mockResolvedValueOnce({ id: "A" });

    const res = await runFormsAction(
      fd({ intent: "move-folder", id: "A", parentId: "A" }),
      "user-1",
    );

    expect(res).toEqual({
      error: "Can't move a folder into itself or its own subfolder.",
      status: 400,
    });
    expect(mockPrisma.formFolder.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.formFolder.update).not.toHaveBeenCalled();
  });

  it("404s when the target parent is gone", async () => {
    mockPrisma.formFolder.findUnique
      .mockResolvedValueOnce({ id: "A" })
      .mockResolvedValueOnce(null);

    const res = await runFormsAction(
      fd({ intent: "move-folder", id: "A", parentId: "ghost" }),
      "user-1",
    );

    expect(res).toEqual({ error: "Parent folder not found", status: 404 });
    expect(mockPrisma.formFolder.update).not.toHaveBeenCalled();
  });
});
