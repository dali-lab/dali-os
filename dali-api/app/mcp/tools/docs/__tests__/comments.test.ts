import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub the registry so the BY_NAME map side-effect doesn't pull in every tool module.
vi.mock("~/mcp/registry", () => {
  class McpInvalidError extends Error {
    status: number;
    constructor(message = "Invalid params") { super(message); this.name = "McpInvalidError"; this.status = 400; }
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'. Expected one of: ${Object.keys(spec).join(", ")}`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { requireForAction, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});
vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isLabMember: vi.fn(), isProjectMember: vi.fn() };
});
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));
vi.mock("~/lib/collabAuth", () => ({
  hydrateAuthors: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/lib/comment-events.server", () => ({
  publishCommentChange: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import {
  LIST_COMMENTS_TOOL,
  runListComments,
  ListCommentsError,
} from "~/mcp/tools/docs/comments";
import {
  MANAGE_COMMENT_TOOL_DEF,
  runManageComment,
  ManageCommentError,
} from "~/mcp/tools/docs/manage-comment";

const mockPrisma = prisma as unknown as {
  docComment: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  projectFile: { findUnique: ReturnType<typeof vi.fn> };
  page: { findUnique: ReturnType<typeof vi.fn> };
  pageDoc: { findUnique: ReturnType<typeof vi.fn> };
  projectFileVersion: { findFirst: ReturnType<typeof vi.fn> };
  docCommentReaction: { upsert: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
};

function comment(id: string, parentId: string | null, createdAt: string) {
  return {
    id,
    parentId,
    authorId: "u2",
    body: "Hello",
    anchor: null,
    createdAt: new Date(createdAt),
    versionId: null,
    updatedAt: new Date(createdAt),
    reactions: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_comments", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_COMMENTS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects doc target when caller lacks canComment access", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canComment: false, canView: false, canEdit: false } as never);
    await expect(
      runListComments("u1", { targetType: "doc", targetId: "page1" }),
    ).rejects.toMatchObject({ name: "ListCommentsError", status: 403 });
  });

  it("returns comments for an authorized doc viewer", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canComment: true, canView: true, canEdit: false } as never);
    mockPrisma.docComment.findMany.mockResolvedValueOnce([comment("c1", null, "2026-01-01")]).mockResolvedValueOnce([]);
    mockPrisma.docComment.count.mockResolvedValue(1);

    const out = await runListComments("u1", { targetType: "doc", targetId: "page1" });
    expect(out.comments).toHaveLength(1);
    expect(out.comments[0]).toMatchObject({ id: "c1", body: "Hello" });
    expect(out.page).toEqual({ nextCursor: null, hasMore: false, limit: 50, total: 1 });
  });

  it("pages root comments with their replies attached, never splitting a thread", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canComment: true, canView: true, canEdit: false } as never);
    mockPrisma.docComment.count.mockResolvedValue(3);
    mockPrisma.docComment.findMany
      .mockResolvedValueOnce([comment("r1", null, "2026-01-01"), comment("r2", null, "2026-01-02"), comment("r3", null, "2026-01-03")])
      .mockResolvedValueOnce([comment("x1", "r1", "2026-01-05"), comment("x2", "r1", "2026-01-06"), comment("y1", "r2", "2026-01-04")]);

    const first = await runListComments("u1", { targetType: "doc", targetId: "page1", limit: 2 });
    const rootsQuery = mockPrisma.docComment.findMany.mock.calls[0][0];
    expect(rootsQuery.where.AND[0]).toEqual({ targetType: "doc", targetId: "page1", parentId: null });
    expect(rootsQuery).toMatchObject({ take: 3, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(mockPrisma.docComment.findMany.mock.calls[1][0].where).toEqual({ parentId: { in: ["r1", "r2"] } });
    expect(first.comments.map((c) => c.id)).toEqual(["r1", "x1", "x2", "r2", "y1"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2, total: 3 });

    mockPrisma.docComment.findMany.mockResolvedValueOnce([comment("r3", null, "2026-01-03")]).mockResolvedValueOnce([]);
    const second = await runListComments("u1", {
      targetType: "doc",
      targetId: "page1",
      limit: 2,
      cursor: first.page.nextCursor!,
    });
    expect(mockPrisma.docComment.findMany.mock.calls[2][0].where.AND[1].OR[0]).toEqual({
      createdAt: { gt: new Date("2026-01-02T00:00:00.000Z") },
    });
    expect(second.comments.map((c) => c.id)).toEqual(["r3"]);
    expect(second.page).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it("rejects file target when caller is not Core or project member", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    mockPrisma.projectFile.findUnique.mockResolvedValue({ projectId: "proj1" });

    await expect(
      runListComments("u1", { targetType: "file", targetId: "file1" }),
    ).rejects.toMatchObject({ name: "ListCommentsError", status: 403 });
  });

  it("returns comments for a pagedoc when caller is a lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    mockPrisma.docComment.findMany.mockResolvedValue([]);
    mockPrisma.docComment.count.mockResolvedValue(0);

    const out = await runListComments("u1", { targetType: "pagedoc", targetId: "pd1" });
    expect(out.comments).toEqual([]);
  });
});

describe("manage_comment", () => {
  it("requires the mcp:write scope", () => {
    expect(MANAGE_COMMENT_TOOL_DEF.requiredScope).toBe("mcp:write");
  });

  it("rejects create when caller lacks access", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canComment: false, canView: false, canEdit: false } as never);
    mockPrisma.page.findUnique.mockResolvedValue({ archivedAt: null });

    await expect(
      runManageComment("u1", { action: "create", targetType: "doc", targetId: "page1", body: "hi" }),
    ).rejects.toMatchObject({ name: "ManageCommentError", status: 403 });
  });

  it("rejects edit when caller is not the author", async () => {
    mockPrisma.docComment.findUnique.mockResolvedValue({
      id: "c1", authorId: "u2", targetType: "doc", targetId: "page1", parentId: null,
    });
    vi.mocked(isCore).mockResolvedValue(false);

    await expect(
      runManageComment("u1", { action: "edit", commentId: "c1", body: "updated" }),
    ).rejects.toMatchObject({ name: "ManageCommentError", status: 403 });
  });

  it("allows the author to edit their comment", async () => {
    mockPrisma.docComment.findUnique.mockResolvedValue({
      id: "c1", authorId: "u1", targetType: "doc", targetId: "page1", parentId: null,
    });
    vi.mocked(isCore).mockResolvedValue(false);
    mockPrisma.docComment.update.mockResolvedValue({ id: "c1" });

    const out = await runManageComment("u1", { action: "edit", commentId: "c1", body: "updated" });
    expect(out).toEqual({ ok: true });
  });

  it("returns 404 for a missing comment", async () => {
    mockPrisma.docComment.findUnique.mockResolvedValue(null);

    await expect(
      runManageComment("u1", { action: "edit", commentId: "missing", body: "x" }),
    ).rejects.toMatchObject({ name: "ManageCommentError", status: 404 });
  });
});
