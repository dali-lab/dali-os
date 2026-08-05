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
vi.mock("~/lib/db");
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

import { prisma } from "~/lib/db";
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_comments", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_COMMENTS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects doc target when caller lacks canComment access", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canComment: false, canView: false, canEdit: false, canResolve: false } as never);
    await expect(
      runListComments("u1", { targetType: "doc", targetId: "page1" }),
    ).rejects.toMatchObject({ name: "ListCommentsError", status: 403 });
  });

  it("returns comments for an authorized doc viewer", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canComment: true, canView: true, canEdit: false, canResolve: false } as never);
    mockPrisma.docComment.findMany.mockResolvedValue([
      {
        id: "c1",
        parentId: null,
        authorId: "u2",
        body: "Hello",
        anchor: null,
        resolvedAt: null,
        createdAt: new Date("2026-01-01"),
        versionId: null,
        updatedAt: new Date("2026-01-01"),
        reactions: [],
      },
    ]);

    const out = await runListComments("u1", { targetType: "doc", targetId: "page1" });
    expect(out.comments).toHaveLength(1);
    expect(out.comments[0]).toMatchObject({ id: "c1", body: "Hello", resolved: false });
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

    const out = await runListComments("u1", { targetType: "pagedoc", targetId: "pd1" });
    expect(out.comments).toEqual([]);
  });
});

describe("manage_comment", () => {
  it("requires the mcp:write scope", () => {
    expect(MANAGE_COMMENT_TOOL_DEF.requiredScope).toBe("mcp:write");
  });

  it("rejects create when caller lacks access", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canComment: false, canView: false, canEdit: false, canResolve: false } as never);
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
      runManageComment("u1", { action: "resolve", commentId: "missing" }),
    ).rejects.toMatchObject({ name: "ManageCommentError", status: 404 });
  });
});
