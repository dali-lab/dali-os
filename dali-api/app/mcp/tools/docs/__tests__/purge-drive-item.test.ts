import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    page: { findUnique: vi.fn(), delete: vi.fn() },
    projectFile: { findUnique: vi.fn(), delete: vi.fn() },
    form: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/fileAccess.server", () => ({ canEditFile: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({ canManageFormPlacement: vi.fn() }));
vi.mock("~/forms/lib/form-page.server", () => ({ deleteForm: vi.fn() }));
vi.mock("~/forms/lib/form-usages.server", () => ({ formDeletionBlockers: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canEditFile } from "~/lib/fileAccess.server";
import { canManageFormPlacement } from "~/forms/lib/form-access.server";
import { deleteForm } from "~/forms/lib/form-page.server";
import { formDeletionBlockers } from "~/forms/lib/form-usages.server";
import { PURGE_DRIVE_ITEM_TOOL_DEF, runPurgeDriveItem } from "../purge-drive-item";
import { toolAnnotations } from "~/mcp/tool-policy";

const m = prisma as unknown as {
  page: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  projectFile: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  form: { findUnique: ReturnType<typeof vi.fn> };
};
const EDIT = { canView: true, canComment: true, canEdit: true } as never;
const VIEW = { canView: true, canComment: false, canEdit: false } as never;
const inTrash = new Date("2026-01-01");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("purge_drive_item", () => {
  it("is a destructive write tool", () => {
    expect(PURGE_DRIVE_ITEM_TOOL_DEF.requiredScope).toBe("mcp:write");
    expect(PURGE_DRIVE_ITEM_TOOL_DEF.inputSchema.required).toEqual(["type", "id"]);
    expect(toolAnnotations(PURGE_DRIVE_ITEM_TOOL_DEF as never).destructiveHint).toBe(true);
  });

  it("deletes a trashed file for an edit-capable caller", async () => {
    m.projectFile.findUnique.mockResolvedValue({ id: "f1", projectId: "p", archivedAt: inTrash });
    vi.mocked(canEditFile).mockResolvedValue(true);
    expect(await runPurgeDriveItem("u1", { type: "file", id: "f1" })).toEqual({ ok: true });
    expect(m.projectFile.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
  });

  it("refuses a file that is not in the trash, or that the caller can't edit", async () => {
    m.projectFile.findUnique.mockResolvedValue({ id: "f1", projectId: "p", archivedAt: null });
    vi.mocked(canEditFile).mockResolvedValue(true);
    await expect(runPurgeDriveItem("u1", { type: "file", id: "f1" })).rejects.toMatchObject({ status: 400 });
    vi.mocked(canEditFile).mockResolvedValue(false);
    await expect(runPurgeDriveItem("u1", { type: "file", id: "f1" })).rejects.toMatchObject({ status: 403 });
    expect(m.projectFile.delete).not.toHaveBeenCalled();
  });

  it("deletes a trashed folder", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(EDIT);
    m.page.findUnique.mockResolvedValue({ folderType: null, archivedAt: inTrash });
    expect(await runPurgeDriveItem("u1", { type: "folder", id: "f1" })).toEqual({ ok: true });
    expect(m.page.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
  });

  it("refuses a live page: only items already in the trash can be purged", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(EDIT);
    m.page.findUnique.mockResolvedValue({ folderType: null, archivedAt: null });
    await expect(runPurgeDriveItem("u1", { type: "doc", id: "p1" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Trash it first") });
    expect(m.page.delete).not.toHaveBeenCalled();
  });

  it("refuses a page the caller can't edit and a missing page", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(VIEW);
    await expect(runPurgeDriveItem("u1", { type: "doc", id: "p1" })).rejects.toMatchObject({ status: 403 });
    vi.mocked(getPageAccess).mockResolvedValue(EDIT);
    m.page.findUnique.mockResolvedValue(null);
    await expect(runPurgeDriveItem("u1", { type: "doc", id: "p1" })).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to purge a Drive root", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(EDIT);
    m.page.findUnique.mockResolvedValue({ folderType: "Root", archivedAt: inTrash });
    await expect(runPurgeDriveItem("u1", { type: "folder", id: "root1" })).rejects.toMatchObject({
      status: 400,
      message: "This is a Drive root and can't be deleted",
    });
    expect(m.page.delete).not.toHaveBeenCalled();
  });

  it("deletes a trashed form once nothing binds it", async () => {
    vi.mocked(canManageFormPlacement).mockResolvedValue(true);
    m.form.findUnique.mockResolvedValue({ id: "frm1", archivedAt: inTrash });
    vi.mocked(formDeletionBlockers).mockResolvedValue([]);
    expect(await runPurgeDriveItem("u1", { type: "form", id: "frm1" })).toEqual({ ok: true });
    expect(deleteForm).toHaveBeenCalledWith("frm1");
  });

  it("refuses a form that is in use, not in the trash, or not the caller's to manage", async () => {
    vi.mocked(canManageFormPlacement).mockResolvedValue(true);
    m.form.findUnique.mockResolvedValue({ id: "frm1", archivedAt: inTrash });
    vi.mocked(formDeletionBlockers).mockResolvedValue(["the 26F application"]);
    await expect(runPurgeDriveItem("u1", { type: "form", id: "frm1" })).rejects.toMatchObject({ status: 409 });
    m.form.findUnique.mockResolvedValue({ id: "frm1", archivedAt: null });
    await expect(runPurgeDriveItem("u1", { type: "form", id: "frm1" })).rejects.toMatchObject({ status: 400 });
    vi.mocked(canManageFormPlacement).mockResolvedValue(false);
    await expect(runPurgeDriveItem("u1", { type: "form", id: "frm1" })).rejects.toMatchObject({ status: 403 });
    expect(deleteForm).not.toHaveBeenCalled();
  });
});
