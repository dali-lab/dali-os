import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/drive/lib/page-names.server", () => ({ findNameConflict: vi.fn() }));
vi.mock("~/drive/lib/notebook-access.server", () => ({ loadManageableNotebook: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { isCore, isProjectMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { findNameConflict } from "~/drive/lib/page-names.server";
import { loadManageableNotebook } from "~/drive/lib/notebook-access.server";
import { runUpdatePage, UpdatePageError } from "~/mcp/tools/update-page";

const mockPrisma = prisma as unknown as {
  page: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const basePage = {
  id: "pg1",
  workspaceType: "Project",
  workspaceId: "p1",
  parentPageId: null,
  kind: "FreeForm",
  archivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(getPageAccess).mockResolvedValue({ canEdit: false } as never);
  vi.mocked(findNameConflict).mockResolvedValue(null);
  vi.mocked(loadManageableNotebook).mockResolvedValue({} as never);
  mockPrisma.page.update.mockResolvedValue({
    id: "pg1",
    title: "T",
    iconEmoji: null,
    parentPageId: null,
    archivedAt: null,
  });
});

describe("update_page", () => {
  it("denies callers who are neither Core nor staffed", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.page.findUnique.mockResolvedValue(basePage);
    await expect(runUpdatePage("u1", { pageId: "pg1", title: "x" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("allows non-Core members staffed on the project (web parity)", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue(basePage);
    await runUpdatePage("u1", { pageId: "pg1", title: "Renamed" });
    expect(isProjectMember).toHaveBeenCalledWith("u1", "p1");
    expect(mockPrisma.page.update).toHaveBeenCalled();
  });

  it("renames and stamps lastEditedBy", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(basePage);
    await runUpdatePage("u1", { pageId: "pg1", title: "  New name  " });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { title: "New name", lastEditedById: "u1" },
      }),
    );
  });

  it("empty iconEmoji clears the icon", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(basePage);
    await runUpdatePage("u1", { pageId: "pg1", iconEmoji: "" });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { iconEmoji: null } }),
    );
  });

  it("refuses to archive a folder with live children", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...basePage, kind: "Folder" });
    mockPrisma.page.count.mockResolvedValue(2);
    await expect(
      runUpdatePage("u1", { pageId: "pg1", archived: true }),
    ).rejects.toThrow(/inside this folder/);
  });

  it("unarchives", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...basePage, archivedAt: new Date() });
    await runUpdatePage("u1", { pageId: "pg1", archived: false });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { archivedAt: null } }),
    );
  });

  it("moves under a top-level Folder, appending position", async () => {
    mockPrisma.page.findUnique
      .mockResolvedValueOnce(basePage) // the page
      .mockResolvedValueOnce({
        // the parent
        workspaceType: "Project",
        workspaceId: "p1",
        parentPageId: null,
        kind: "Folder",
        archivedAt: null,
      });
    mockPrisma.page.findFirst.mockResolvedValue({ position: 5 });
    await runUpdatePage("u1", { pageId: "pg1", parentPageId: "folder1" });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { parentPageId: "folder1", position: 6 } }),
    );
  });

  it("rejects moving under a non-Folder", async () => {
    mockPrisma.page.findUnique
      .mockResolvedValueOnce(basePage)
      .mockResolvedValueOnce({
        workspaceType: "Project",
        workspaceId: "p1",
        parentPageId: null,
        kind: "FreeForm",
        archivedAt: null,
      });
    await expect(
      runUpdatePage("u1", { pageId: "pg1", parentPageId: "doc2" }),
    ).rejects.toThrow(/inside a folder/);
  });

  it("moves a Folder under another folder (nesting allowed)", async () => {
    mockPrisma.page.findUnique
      .mockResolvedValueOnce({ ...basePage, kind: "Folder" }) // the page (a folder)
      .mockResolvedValueOnce({
        // the parent folder
        workspaceType: "Project",
        workspaceId: "p1",
        parentPageId: null,
        kind: "Folder",
        archivedAt: null,
      })
      .mockResolvedValueOnce({ parentPageId: null }) // pageDepth walk
      .mockResolvedValueOnce({ parentPageId: null }); // isAncestorOf walk (no cycle)
    mockPrisma.page.findFirst.mockResolvedValue({ position: 2 });
    await runUpdatePage("u1", { pageId: "pg1", parentPageId: "folder1" });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { parentPageId: "folder1", position: 3 } }),
    );
  });

  it("rejects moving a folder into its own descendant", async () => {
    mockPrisma.page.findUnique
      .mockResolvedValueOnce({ ...basePage, kind: "Folder" }) // page pg1
      .mockResolvedValueOnce({
        // parent folder1 is itself a child of pg1
        workspaceType: "Project",
        workspaceId: "p1",
        parentPageId: "pg1",
        kind: "Folder",
        archivedAt: null,
      })
      .mockResolvedValueOnce({ parentPageId: "pg1" }) // pageDepth: folder1 → pg1
      .mockResolvedValueOnce({ parentPageId: null }) // pageDepth: pg1 → root
      .mockResolvedValueOnce({ parentPageId: "pg1" }); // isAncestorOf: folder1's parent is pg1 → cycle
    await expect(
      runUpdatePage("u1", { pageId: "pg1", parentPageId: "folder1" }),
    ).rejects.toThrow(/its own contents/);
  });

  it("400s when nothing would change", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(basePage);
    await expect(runUpdatePage("u1", { pageId: "pg1" })).rejects.toThrow(/Nothing to update/);
  });

  it("404s a page in a workspace with no editable documents", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...basePage, workspaceType: "Partner", workspaceId: "x" });
    await expect(runUpdatePage("u1", { pageId: "pg1", title: "x" })).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.page.update).not.toHaveBeenCalled();
  });

  it("404s a missing page", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(null);
    await expect(runUpdatePage("u1", { pageId: "pg1", title: "x" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("update_page renaming outside projects", () => {
  const notebookTab = {
    ...basePage,
    workspaceType: "Lab",
    workspaceId: null,
    parentPageId: "nb1",
  };

  it("renames a Lab notebook tab the caller can edit", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(notebookTab);
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as never);
    await runUpdatePage("u1", { pageId: "pg1", title: "  Kickoff with Prof. Lee  " });
    expect(getPageAccess).toHaveBeenCalledWith("u1", "pg1", undefined);
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: "Kickoff with Prof. Lee", lastEditedById: "u1" } }),
    );
    expect(findNameConflict).toHaveBeenCalledWith({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "nb1",
      kind: "FreeForm",
      title: "Kickoff with Prof. Lee",
      excludeId: "pg1",
    });
  });

  it("404s a Lab page the caller can't edit, without confirming it exists", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(notebookTab);
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: false } as never);
    await expect(runUpdatePage("u1", { pageId: "pg1", title: "x" })).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.page.update).not.toHaveBeenCalled();
  });

  it("renames the caller's own personal note without a share lookup", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...basePage, workspaceType: "Member", workspaceId: "u1" });
    await runUpdatePage("u1", { pageId: "pg1", title: "Reading list" });
    expect(getPageAccess).not.toHaveBeenCalled();
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: "Reading list", lastEditedById: "u1" } }),
    );
  });

  it("renames someone else's note only with an edit share", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...basePage, workspaceType: "Member", workspaceId: "u2" });
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: false } as never);
    await expect(runUpdatePage("u1", { pageId: "pg1", title: "x" })).rejects.toMatchObject({ status: 404 });
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as never);
    await runUpdatePage("u1", { pageId: "pg1", title: "Shared plan" });
    expect(mockPrisma.page.update).toHaveBeenCalledTimes(1);
  });

  it("renames an Education page the caller can edit", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...basePage, workspaceType: "EducationOffering", workspaceId: "o1" });
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as never);
    await runUpdatePage("u1", { pageId: "pg1", iconEmoji: "📓" });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(expect.objectContaining({ data: { iconEmoji: "📓" } }));
  });

  it.each([
    [{ archived: true }],
    [{ parentPageId: "f1" }],
  ])("refuses to move or archive a non-project page: %j", async (rest) => {
    mockPrisma.page.findUnique.mockResolvedValue(notebookTab);
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as never);
    await expect(runUpdatePage("u1", { pageId: "pg1", ...rest })).rejects.toMatchObject({ status: 400 });
    expect(mockPrisma.page.update).not.toHaveBeenCalled();
  });

  it("rejects a blank title", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(notebookTab);
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as never);
    await expect(runUpdatePage("u1", { pageId: "pg1", title: "   " })).rejects.toMatchObject({ status: 400 });
    expect(mockPrisma.page.update).not.toHaveBeenCalled();
  });
});

describe("update_page rename checks shared with the web", () => {
  it("409s a title already taken by a sibling", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(basePage);
    vi.mocked(findNameConflict).mockResolvedValue("A document named “Plan” already exists here.");
    await expect(runUpdatePage("u1", { pageId: "pg1", title: "Plan" })).rejects.toMatchObject({
      status: 409,
      message: "A document named “Plan” already exists here.",
    });
    expect(mockPrisma.page.update).not.toHaveBeenCalled();
  });

  it("renames a notebook only when the caller can manage it", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...basePage, kind: "Notebook" });
    vi.mocked(loadManageableNotebook).mockRejectedValue(
      Object.assign(new Error("You can't manage this notebook"), { status: 403 }),
    );
    await expect(runUpdatePage("u1", { pageId: "pg1", title: "Standups" })).rejects.toMatchObject({ status: 403 });
    expect(mockPrisma.page.update).not.toHaveBeenCalled();

    vi.mocked(loadManageableNotebook).mockResolvedValue({} as never);
    await runUpdatePage("u1", { pageId: "pg1", title: "Standups" });
    expect(loadManageableNotebook).toHaveBeenCalledWith("pg1", "u1", undefined);
    expect(mockPrisma.page.update).toHaveBeenCalledTimes(1);
  });

  it("does not run the notebook check for an icon-only change", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...basePage, kind: "Notebook" });
    await runUpdatePage("u1", { pageId: "pg1", iconEmoji: "📒" });
    expect(loadManageableNotebook).not.toHaveBeenCalled();
    expect(findNameConflict).not.toHaveBeenCalled();
  });
});
