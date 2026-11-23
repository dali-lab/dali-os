import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    page: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    projectFile: { findUnique: vi.fn(), update: vi.fn() },
    form: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/pages.server", () => ({ collectSubtree: vi.fn(), createLabPage: vi.fn(), pageDepth: vi.fn(), MAX_PAGE_DEPTH: 6 }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMemberOrAlum: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn(), PAGE_ACCESS_SELECT: {} }));
vi.mock("~/lib/fileAccess.server", () => ({ canEditFile: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/forms/lib/form-access.server", () => ({ canManageFormPlacement: vi.fn() }));
vi.mock("~/forms/lib/form-page.server", () => ({ setFormArchived: vi.fn(), deleteForm: vi.fn(), moveForm: vi.fn() }));
vi.mock("~/drive/lib/page-copy.server", () => ({ duplicatePage: vi.fn() }));
vi.mock("~/calendar/lib/notebooks.server", () => ({ trashNotebook: vi.fn() }));
vi.mock("~/members/lib/personal-notes-actions.server", () => ({ archiveNote: vi.fn() }));
vi.mock("~/members/lib/personal-notes.server", () => ({
  requireNoteOwner: vi.fn(),
  NoteForbiddenError: class NoteForbiddenError extends Error {},
  NoteNotFoundError: class NoteNotFoundError extends Error {},
}));

import { prisma } from "~/lib/db.server";
import { collectSubtree } from "~/lib/pages.server";
import { isCore, isLabMemberOrAlum, isProjectMember } from "~/lib/roles";
import { canEditFile } from "~/lib/fileAccess.server";
import { canManageFormPlacement } from "~/forms/lib/form-access.server";
import { setFormArchived } from "~/forms/lib/form-page.server";
import { trashNotebook } from "~/calendar/lib/notebooks.server";
import { archiveNote } from "~/members/lib/personal-notes-actions.server";
import { NoteForbiddenError, requireNoteOwner } from "~/members/lib/personal-notes.server";
import { runManageDriveTrash } from "../manage-drive-trash";

const m = prisma as unknown as {
  page: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  projectFile: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  form: { findUnique: ReturnType<typeof vi.fn> };
};

const CLEARED = { folderType: null, processType: null, processId: null };
const trash = (type: "doc" | "folder" | "file" | "form", id: string) =>
  runManageDriveTrash("u1", { action: "trash", type, id });
const livePage = (over: Record<string, unknown> = {}) => ({
  id: "p1", title: "T", kind: "FreeForm", workspaceType: "Lab", workspaceId: null, archivedAt: null, createdById: "u1", folderType: null, partnerVisible: false, publicVisible: false, pinnedAt: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(collectSubtree).mockResolvedValue({ ids: [], height: 0 });
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isLabMemberOrAlum).mockResolvedValue(true);
  vi.mocked(isProjectMember).mockResolvedValue(false);
});

describe("manage_drive_trash trash: pages", () => {
  it("needs a type and an id", async () => {
    await expect(runManageDriveTrash("u1", { action: "trash", type: "doc" } as never)).rejects.toMatchObject({ status: 400 });
  });

  it("404s a page that doesn't exist", async () => {
    m.page.findUnique.mockResolvedValue(null);
    await expect(trash("doc", "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("sends a form page to the form path", async () => {
    m.page.findUnique.mockResolvedValue(livePage({ kind: "Form" }));
    await expect(trash("doc", "p1")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("form") });
  });

  it("trashes a lab page for its creator", async () => {
    m.page.findUnique.mockResolvedValueOnce(livePage()).mockResolvedValueOnce(livePage());
    expect(await trash("doc", "p1")).toEqual({ ok: true, archivedDescendants: 0 });
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { archivedAt: expect.any(Date), ...CLEARED } });
  });

  it("refuses a lab page the caller neither created nor Core manages", async () => {
    m.page.findUnique.mockResolvedValueOnce(livePage()).mockResolvedValueOnce(livePage({ createdById: "u2" }));
    await expect(trash("doc", "p1")).rejects.toMatchObject({ status: 403 });
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("trashes a lab folder with everything inside it", async () => {
    m.page.findUnique.mockResolvedValue(livePage({ kind: "Folder" }));
    vi.mocked(collectSubtree).mockResolvedValue({ ids: ["a", "b"], height: 1 });
    expect(await trash("folder", "p1")).toEqual({ ok: true, archivedDescendants: 2 });
    expect(m.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, archivedAt: null },
      data: { ...CLEARED, archivedAt: expect.any(Date) },
    });
    expect(m.page.update.mock.calls[0][0].data.archivedAt).toBe(m.page.updateMany.mock.calls[0][0].data.archivedAt);
  });

  it("trashes a project page for someone staffed on the project", async () => {
    const project = livePage({ workspaceType: "Project", workspaceId: "proj1" });
    m.page.findUnique.mockResolvedValue(project);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    expect(await trash("doc", "p1")).toEqual({ ok: true, archivedDescendants: 0 });
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { archivedAt: expect.any(Date), partnerVisible: false, publicVisible: false, ...CLEARED },
    });
  });

  it("trashes a project folder with its subtree instead of refusing, and unshares what it trashes", async () => {
    m.page.findUnique.mockResolvedValue(livePage({ kind: "Folder", workspaceType: "Project", workspaceId: "proj1" }));
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(collectSubtree).mockResolvedValue({ ids: ["a", "b", "c"], height: 2 });
    expect(await trash("folder", "p1")).toEqual({ ok: true, archivedDescendants: 3 });
    expect(m.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b", "c"] }, archivedAt: null },
      data: { partnerVisible: false, publicVisible: false, ...CLEARED, archivedAt: expect.any(Date) },
    });
    expect(m.page.update.mock.calls[0][0].data.archivedAt).toBe(m.page.updateMany.mock.calls[0][0].data.archivedAt);
  });

  it("refuses a project page for someone who is neither Core nor staffed", async () => {
    m.page.findUnique.mockResolvedValue(livePage({ workspaceType: "Project", workspaceId: "proj1" }));
    await expect(trash("doc", "p1")).rejects.toMatchObject({ status: 403 });
    expect(m.page.update).not.toHaveBeenCalled();
    expect(m.page.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a project page that is already in the trash", async () => {
    m.page.findUnique.mockResolvedValue(livePage({ workspaceType: "Project", workspaceId: "proj1", archivedAt: new Date() }));
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(trash("doc", "p1")).rejects.toMatchObject({ status: 400 });
  });

  it("trashes a notebook through the notebook rules", async () => {
    m.page.findUnique.mockResolvedValue(livePage({ kind: "Notebook" }));
    expect(await trash("doc", "p1")).toEqual({ ok: true });
    expect(trashNotebook).toHaveBeenCalledWith("p1", "u1");
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("passes on a notebook the caller can't manage", async () => {
    m.page.findUnique.mockResolvedValue(livePage({ kind: "Notebook" }));
    vi.mocked(trashNotebook).mockRejectedValue(Object.assign(new Error("You can't manage this notebook"), { status: 403 }));
    await expect(trash("doc", "p1")).rejects.toMatchObject({ status: 403 });
  });

  it("archives a personal note for its owner", async () => {
    m.page.findUnique.mockResolvedValue(livePage({ workspaceType: "Member", workspaceId: "u1" }));
    expect(await trash("doc", "p1")).toEqual({ ok: true, archivedDescendants: 0 });
    expect(requireNoteOwner).toHaveBeenCalledWith("p1", "u1");
    expect(archiveNote).toHaveBeenCalledWith("p1", "u1", expect.any(Date));
  });

  it("trashes a personal folder's notes before the folder and takes them off the profile", async () => {
    m.page.findUnique.mockResolvedValue(livePage({ kind: "Folder", workspaceType: "Member", workspaceId: "u1" }));
    vi.mocked(collectSubtree).mockResolvedValue({ ids: ["n1", "n2"], height: 1 });
    expect(await trash("folder", "p1")).toEqual({ ok: true, archivedDescendants: 2 });
    expect(m.page.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["n1", "n2"] }, archivedAt: null },
      data: { profileVisible: false, labListing: "None", archivedAt: expect.any(Date) },
    });
    expect(m.page.updateMany.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(archiveNote).mock.invocationCallOrder[0]);
    expect(vi.mocked(archiveNote).mock.calls[0][2]).toBe(m.page.updateMany.mock.calls[0][0].data.archivedAt);
  });

  it("refuses someone else's personal note without trashing anything", async () => {
    m.page.findUnique.mockResolvedValue(livePage({ kind: "Folder", workspaceType: "Member", workspaceId: "u2" }));
    vi.mocked(requireNoteOwner).mockRejectedValue(new NoteForbiddenError("Only the note's owner can change it"));
    vi.mocked(collectSubtree).mockResolvedValue({ ids: ["n1"], height: 1 });
    await expect(trash("folder", "p1")).rejects.toMatchObject({ status: 403 });
    expect(m.page.updateMany).not.toHaveBeenCalled();
    expect(archiveNote).not.toHaveBeenCalled();
  });

  it("leaves course materials to manage_offering_materials", async () => {
    m.page.findUnique.mockResolvedValue(livePage({ workspaceType: "EducationOffering", workspaceId: "o1" }));
    await expect(trash("doc", "p1")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("manage_offering_materials") });
    expect(m.page.update).not.toHaveBeenCalled();
  });
});

describe("manage_drive_trash trash: files and forms", () => {
  const file = (over: Record<string, unknown> = {}) => ({
    id: "f1", title: "Plan.pdf", projectId: "proj1", workspaceType: null, workspaceId: null, folderPageId: null, archivedAt: null, ...over,
  });

  it("archives a project file for someone staffed on the project", async () => {
    m.projectFile.findUnique.mockResolvedValue(file());
    vi.mocked(isProjectMember).mockResolvedValue(true);
    expect(await trash("file", "f1")).toEqual({ ok: true, alreadyInTrash: false });
    expect(m.projectFile.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { archivedAt: expect.any(Date), partnerVisible: false } });
  });

  it("refuses a project file for someone who is neither Core nor staffed", async () => {
    m.projectFile.findUnique.mockResolvedValue(file());
    await expect(trash("file", "f1")).rejects.toMatchObject({ status: 403 });
    expect(m.projectFile.update).not.toHaveBeenCalled();
  });

  it("archives a drive file outside a project when the caller can edit it", async () => {
    m.projectFile.findUnique.mockResolvedValue(file({ projectId: null, workspaceType: "Lab" }));
    vi.mocked(canEditFile).mockResolvedValue(true);
    expect(await trash("file", "f1")).toEqual({ ok: true, alreadyInTrash: false });
    expect(m.projectFile.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { archivedAt: expect.any(Date) } });
  });

  it("refuses a drive file the caller can't edit", async () => {
    m.projectFile.findUnique.mockResolvedValue(file({ projectId: null, workspaceType: "Lab" }));
    vi.mocked(canEditFile).mockResolvedValue(false);
    await expect(trash("file", "f1")).rejects.toMatchObject({ status: 403 });
    expect(m.projectFile.update).not.toHaveBeenCalled();
  });

  it("404s a missing file", async () => {
    m.projectFile.findUnique.mockResolvedValue(null);
    await expect(trash("file", "nope")).rejects.toMatchObject({ status: 404 });
  });

  it("archives a form for someone who can manage its placement", async () => {
    vi.mocked(canManageFormPlacement).mockResolvedValue(true);
    m.form.findUnique.mockResolvedValue({ id: "frm1", archivedAt: null });
    expect(await trash("form", "frm1")).toEqual({ ok: true });
    expect(setFormArchived).toHaveBeenCalledWith("frm1", expect.any(Date));
  });

  it("refuses a form the caller can't manage and a form already in the trash", async () => {
    vi.mocked(canManageFormPlacement).mockResolvedValue(false);
    await expect(trash("form", "frm1")).rejects.toMatchObject({ status: 403 });
    vi.mocked(canManageFormPlacement).mockResolvedValue(true);
    m.form.findUnique.mockResolvedValue({ id: "frm1", archivedAt: new Date() });
    await expect(trash("form", "frm1")).rejects.toMatchObject({ status: 400 });
    expect(setFormArchived).not.toHaveBeenCalled();
  });
});
