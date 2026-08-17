import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { runFormsAction } from "~/forms/lib/forms-data";

const mockPrisma = prisma as unknown as {
  form: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  page: {
    findFirst: ReturnType<typeof vi.fn>;
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
      fd({ intent: "move-form", id: "form-1", folderPageId: "" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: { folderPageId: null },
    });
    // "" short-circuits resolveFolderPageId — no folder existence query.
    expect(mockPrisma.page.findFirst).not.toHaveBeenCalled();
  });

  it("moves a form into an existing Drive folder", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    mockPrisma.page.findFirst.mockResolvedValue({ id: "folder-1" });

    const res = await runFormsAction(
      fd({ intent: "move-form", id: "form-1", folderPageId: "folder-1" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: { folderPageId: "folder-1" },
    });
  });

  it("404s when the destination folder is gone", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    mockPrisma.page.findFirst.mockResolvedValue(null);

    const res = await runFormsAction(
      fd({ intent: "move-form", id: "form-1", folderPageId: "ghost" }),
      "user-1",
    );

    expect(res).toEqual({ error: "Folder not found", status: 404 });
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });

  it("404s when the form is gone", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(null);

    const res = await runFormsAction(
      fd({ intent: "move-form", id: "ghost", folderPageId: "" }),
      "user-1",
    );

    expect(res).toEqual({ error: "Not found", status: 404 });
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });
});
