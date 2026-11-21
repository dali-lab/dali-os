import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isLabMemberOrAlum: vi.fn() };
});
vi.mock("~/lib/pages.server", () => ({
  createLabPage: vi.fn(),
  pageDepth: vi.fn(),
  MAX_PAGE_DEPTH: 6,
}));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { isCore, isLabMemberOrAlum } from "~/lib/roles";
import { createLabPage, pageDepth } from "~/lib/pages.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import {
  LIST_LAB_DOCUMENTS_TOOL,
  runListLabDocuments,
  CREATE_LAB_DOCUMENT_TOOL,
  runCreateLabDocument,
  DELETE_LAB_DOCUMENT_TOOL,
  runDeleteLabDocument,
  LabDocumentError,
} from "~/mcp/tools/docs/lab-documents";

const mockPrisma = prisma as unknown as {
  page: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_lab_documents", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_LAB_DOCUMENTS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects non-lab-members", async () => {
    vi.mocked(isLabMemberOrAlum).mockResolvedValue(false);
    await expect(runListLabDocuments("u1", {})).rejects.toMatchObject({
      name: "LabDocumentError",
      status: 403,
    });
  });

  it("returns documents for a lab member", async () => {
    vi.mocked(isLabMemberOrAlum).mockResolvedValue(true);
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "p1", title: "Docs", kind: "FreeForm", parentPageId: null, pinnedAt: null, position: 0, updatedAt: new Date("2026-01-01"), iconEmoji: null, tags: [] },
    ]);

    const out = await runListLabDocuments("u1", {});
    expect(out.documents).toHaveLength(1);
    expect(out.documents[0]).toMatchObject({ id: "p1", title: "Docs", pinned: false });
  });

  it("pages with an id tiebreak and a cursor, and the last page has none", async () => {
    vi.mocked(isLabMemberOrAlum).mockResolvedValue(true);
    mockPrisma.page.count.mockResolvedValue(3);
    const row = (id: string) => ({ id, title: id, kind: "FreeForm", parentPageId: null, pinnedAt: null, position: 0, updatedAt: new Date("2026-01-01"), iconEmoji: null, tags: [] });
    mockPrisma.page.findMany.mockResolvedValueOnce([row("a"), row("b"), row("c")]);

    const first = await runListLabDocuments("u1", { limit: 2 });
    expect(mockPrisma.page.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ pinnedAt: "desc" }, { position: "asc" }, { id: "asc" }],
      skip: 0,
      take: 3,
    });
    expect(first.documents.map((d) => d.id)).toEqual(["a", "b"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2, total: 3 });

    mockPrisma.page.findMany.mockResolvedValueOnce([row("c")]);
    const second = await runListLabDocuments("u1", { limit: 2, cursor: first.page.nextCursor! });
    expect(mockPrisma.page.findMany.mock.calls[1][0]).toMatchObject({ skip: 2 });
    expect(second.documents.map((d) => d.id)).toEqual(["c"]);
    expect(second.page).toMatchObject({ nextCursor: null, hasMore: false });
  });
});

describe("create_lab_document", () => {
  it("requires the mcp:write scope", () => {
    expect(CREATE_LAB_DOCUMENT_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects non-lab-members", async () => {
    vi.mocked(isLabMemberOrAlum).mockResolvedValue(false);
    await expect(
      runCreateLabDocument("u1", { title: "New doc" }),
    ).rejects.toMatchObject({ name: "LabDocumentError", status: 403 });
  });

  it("creates a lab document for a lab member", async () => {
    vi.mocked(isLabMemberOrAlum).mockResolvedValue(true);
    vi.mocked(createLabPage).mockResolvedValue({ id: "new-page" } as never);

    const out = await runCreateLabDocument("u1", { title: "New doc" });
    expect(out).toEqual({ id: "new-page" });
    expect(createLabPage).toHaveBeenCalledWith(expect.objectContaining({ title: "New doc", createdById: "u1" }));
  });

  describe("inside a folder", () => {
    const labFolder = { workspaceType: "Lab", workspaceId: null, kind: "Folder", archivedAt: null };

    beforeEach(() => {
      vi.mocked(isLabMemberOrAlum).mockResolvedValue(true);
      vi.mocked(createLabPage).mockResolvedValue({ id: "decks" } as never);
      mockPrisma.page.findUnique.mockResolvedValue(labFolder);
      vi.mocked(pageDepth).mockResolvedValue(1);
      vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as never);
    });

    it("nests a folder inside a nested folder the caller can edit", async () => {
      const out = await runCreateLabDocument("u1", { title: "Decks", kind: "Folder", parentPageId: "core-partners" });
      expect(out).toEqual({ id: "decks" });
      expect(pageDepth).toHaveBeenCalledWith("core-partners");
      expect(getPageAccess).toHaveBeenCalledWith("u1", "core-partners");
      expect(createLabPage).toHaveBeenCalledWith({
        title: "Decks",
        createdById: "u1",
        kind: "Folder",
        parentPageId: "core-partners",
      });
    });

    it("nests a document two folders down", async () => {
      vi.mocked(pageDepth).mockResolvedValue(2);
      await runCreateLabDocument("u1", { title: "Notes", parentPageId: "deep" });
      expect(createLabPage).toHaveBeenCalledWith(expect.objectContaining({ parentPageId: "deep" }));
    });

    it.each([6, 7, -1])("refuses a folder at depth %i", async (depth) => {
      vi.mocked(pageDepth).mockResolvedValue(depth);
      await expect(
        runCreateLabDocument("u1", { title: "Too deep", kind: "Folder", parentPageId: "deep" }),
      ).rejects.toMatchObject({ status: 400, message: "Folder is too deeply nested" });
      expect(createLabPage).not.toHaveBeenCalled();
    });

    it("refuses a folder the caller can't edit, such as a Core-only one", async () => {
      vi.mocked(getPageAccess).mockResolvedValue({ canEdit: false } as never);
      await expect(
        runCreateLabDocument("u1", { title: "Decks", kind: "Folder", parentPageId: "core-partners" }),
      ).rejects.toMatchObject({ status: 403, message: "You can't put things in that folder" });
      expect(createLabPage).not.toHaveBeenCalled();
    });

    it.each([
      ["missing", null, 404],
      ["archived", { ...labFolder, archivedAt: new Date() }, 404],
      ["in a project", { ...labFolder, workspaceType: "Project", workspaceId: "p1" }, 404],
      ["a document", { ...labFolder, kind: "FreeForm" }, 400],
    ])("refuses a parent that is %s", async (_label, parent, status) => {
      mockPrisma.page.findUnique.mockResolvedValue(parent);
      await expect(
        runCreateLabDocument("u1", { title: "Decks", kind: "Folder", parentPageId: "x" }),
      ).rejects.toMatchObject({ status });
      expect(createLabPage).not.toHaveBeenCalled();
    });
  });
});

describe("delete_lab_document", () => {
  it("requires the mcp:write scope", () => {
    expect(DELETE_LAB_DOCUMENT_TOOL.requiredScope).toBe("mcp:write");
  });

  it("returns 404 for a non-Lab page", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ id: "p1", workspaceType: "Project", workspaceId: "proj1", archivedAt: null, createdById: "u1" });
    vi.mocked(isCore).mockResolvedValue(false);

    await expect(runDeleteLabDocument("u1", { pageId: "p1" })).rejects.toMatchObject({
      name: "LabDocumentError",
      status: 404,
    });
  });

  it("rejects when caller is neither Core nor creator", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ id: "p1", workspaceType: "Lab", workspaceId: null, archivedAt: null, createdById: "u2" });
    vi.mocked(isCore).mockResolvedValue(false);

    await expect(runDeleteLabDocument("u1", { pageId: "p1" })).rejects.toMatchObject({
      name: "LabDocumentError",
      status: 403,
    });
  });

  it("refuses to archive a Drive root, even for Core", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ id: "p1", workspaceType: "Lab", workspaceId: null, archivedAt: null, createdById: "u1", folderType: "Root" });
    vi.mocked(isCore).mockResolvedValue(true);

    await expect(runDeleteLabDocument("u1", { pageId: "p1" })).rejects.toMatchObject({
      name: "LabDocumentError",
      status: 400,
      message: "This is a Drive root and can't be deleted",
    });
    expect(mockPrisma.page.update).not.toHaveBeenCalled();
  });

  it("clears a receiver's type columns in the same update that archives it", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ id: "p1", workspaceType: "Lab", workspaceId: null, archivedAt: null, createdById: "u1", folderType: "Agreements" });
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.page.update.mockResolvedValue({ id: "p1" });

    await runDeleteLabDocument("u1", { pageId: "p1" });

    expect(mockPrisma.page.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { archivedAt: expect.any(Date), folderType: null, processType: null, processId: null },
    });
  });

  it("archives the page when caller is the creator", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ id: "p1", workspaceType: "Lab", workspaceId: null, archivedAt: null, createdById: "u1" });
    vi.mocked(isCore).mockResolvedValue(false);
    mockPrisma.page.update.mockResolvedValue({ id: "p1" });

    const out = await runDeleteLabDocument("u1", { pageId: "p1" });
    expect(out).toEqual({ ok: true });
    expect(mockPrisma.page.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ archivedAt: expect.any(Date) }) }),
    );
  });
});
