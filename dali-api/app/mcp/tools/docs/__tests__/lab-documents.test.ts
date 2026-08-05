import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isLabMember: vi.fn() };
});
vi.mock("~/lib/pages", () => ({
  createLabPage: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore, isLabMember } from "~/lib/roles";
import { createLabPage } from "~/lib/pages";
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
    vi.mocked(isLabMember).mockResolvedValue(false);
    await expect(runListLabDocuments("u1", {})).rejects.toMatchObject({
      name: "LabDocumentError",
      status: 403,
    });
  });

  it("returns documents for a lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "p1", title: "Docs", kind: "FreeForm", parentPageId: null, pinnedAt: null, position: 0, updatedAt: new Date("2026-01-01"), iconEmoji: null, tags: [] },
    ]);

    const out = await runListLabDocuments("u1", {});
    expect(out.documents).toHaveLength(1);
    expect(out.documents[0]).toMatchObject({ id: "p1", title: "Docs", pinned: false });
  });
});

describe("create_lab_document", () => {
  it("requires the mcp:write scope", () => {
    expect(CREATE_LAB_DOCUMENT_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects non-lab-members", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    await expect(
      runCreateLabDocument("u1", { title: "New doc" }),
    ).rejects.toMatchObject({ name: "LabDocumentError", status: 403 });
  });

  it("creates a lab document for a lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    vi.mocked(createLabPage).mockResolvedValue({ id: "new-page" } as never);

    const out = await runCreateLabDocument("u1", { title: "New doc" });
    expect(out).toEqual({ id: "new-page" });
    expect(createLabPage).toHaveBeenCalledWith(expect.objectContaining({ title: "New doc", createdById: "u1" }));
  });

  it("rejects Folder with a parentPageId", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    await expect(
      runCreateLabDocument("u1", { title: "Nested folder", kind: "Folder", parentPageId: "parent1" }),
    ).rejects.toMatchObject({ name: "LabDocumentError", status: 400 });
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
