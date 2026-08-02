import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isLabMember: vi.fn(),
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { action } from "~/routes/api.comments.$id";

const mockPrismaTyped = prisma as any;

const COMMENT_ID = "cmt-1";
const AUTHOR_ID = "author-1";
const OTHER_ID = "other-1";
const PAGE_ID = "page-1";

const mockPrisma = prisma as any;

function baseComment(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_ID,
    authorId: AUTHOR_ID,
    targetType: "doc",
    targetId: PAGE_ID,
    parentId: null,
    ...overrides,
  };
}

function post(intent: string, sub = AUTHOR_ID, overrides: Record<string, unknown> = {}) {
  const request = new Request(`http://localhost/api/comments/${COMMENT_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, ...overrides }),
  });
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub, type: "member" } } as any);
  return action({ request, params: { id: COMMENT_ID } } as any);
}

function del(sub = AUTHOR_ID) {
  const request = new Request(`http://localhost/api/comments/${COMMENT_ID}`, {
    method: "DELETE",
  });
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub, type: "member" } } as any);
  return action({ request, params: { id: COMMENT_ID } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  mockPrisma.docComment.findUnique.mockResolvedValue(baseComment());
  mockPrisma.docComment.update.mockResolvedValue({});
  mockPrisma.docComment.delete.mockResolvedValue({});
  mockPrisma.pageDoc.findUnique.mockResolvedValue(null);
  vi.mocked(getPageAccess).mockResolvedValue({
    canView: true,
    canEdit: true,
    canComment: true,
    canResolve: true,
  });
});

// ── 404 on missing comment ───────────────────────────────────────────────────
describe("comment not found", () => {
  it("returns 404 when the comment doesn't exist", async () => {
    mockPrisma.docComment.findUnique.mockResolvedValue(null);
    const res = (await post("resolve")) as Response;
    expect(res.status).toBe(404);
  });
});

// ── edit intent ──────────────────────────────────────────────────────────────
describe("edit intent", () => {
  it("allows the author to edit their comment body", async () => {
    const res = (await post("edit", AUTHOR_ID, { body: "Updated text" })) as Response;
    expect(res.status).toBe(200);
    expect(mockPrisma.docComment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { body: "Updated text" } }),
    );
  });

  it("rejects a non-author editing someone else's comment", async () => {
    const res = (await post("edit", OTHER_ID, { body: "Malicious edit" })) as Response;
    expect(res.status).toBe(403);
    expect(mockPrisma.docComment.update).not.toHaveBeenCalled();
  });

  it("rejects an empty body", async () => {
    const res = (await post("edit", AUTHOR_ID, { body: "   " })) as Response;
    expect(res.status).toBe(400);
  });

  it("works on any target type (file comment edit)", async () => {
    mockPrisma.docComment.findUnique.mockResolvedValue(
      baseComment({ targetType: "file", targetId: "file-1" }),
    );
    const res = (await post("edit", AUTHOR_ID, { body: "Updated file comment" })) as Response;
    expect(res.status).toBe(200);
  });

  it("works on pagedoc target", async () => {
    mockPrisma.docComment.findUnique.mockResolvedValue(
      baseComment({ targetType: "pagedoc", targetId: "pd-1" }),
    );
    const res = (await post("edit", AUTHOR_ID, { body: "Updated FAQ" })) as Response;
    expect(res.status).toBe(200);
  });
});

// ── set-anchor intent ────────────────────────────────────────────────────────
describe("set-anchor intent", () => {
  it("allows author to set anchor on a doc comment", async () => {
    const anchor = { from: "abc", to: "def" };
    const res = (await post("set-anchor", AUTHOR_ID, { anchor })) as Response;
    expect(res.status).toBe(200);
    expect(mockPrisma.docComment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { anchor } }),
    );
  });

  it("rejects non-author setting anchor", async () => {
    const res = (await post("set-anchor", OTHER_ID, { anchor: { from: "a", to: "b" } })) as Response;
    expect(res.status).toBe(403);
  });

  it("rejects set-anchor on non-doc target", async () => {
    mockPrisma.docComment.findUnique.mockResolvedValue(
      baseComment({ targetType: "file", targetId: "file-1" }),
    );
    const res = (await post("set-anchor", AUTHOR_ID, { anchor: {} })) as Response;
    expect(res.status).toBe(400);
  });
});

// ── resolve / reopen on doc ──────────────────────────────────────────────────
describe("resolve/reopen on doc", () => {
  it("allows resolve when canResolve=true", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({
      canView: true,
      canEdit: true,
      canComment: true,
      canResolve: true,
    });
    const res = (await post("resolve", OTHER_ID)) as Response;
    expect(res.status).toBe(200);
    expect(getPageAccess).toHaveBeenCalledWith(OTHER_ID, PAGE_ID);
  });

  it("denies resolve when canResolve=false (viewer-only)", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({
      canView: true,
      canEdit: false,
      canComment: true,
      canResolve: false,
    });
    const res = (await post("resolve", OTHER_ID)) as Response;
    expect(res.status).toBe(403);
  });

  it("allows Core to resolve even without direct canResolve (Core check in getPageAccess)", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(getPageAccess).mockResolvedValue({
      canView: true,
      canEdit: true,
      canComment: true,
      canResolve: true,
    });
    const res = (await post("resolve", "core-user")) as Response;
    expect(res.status).toBe(200);
  });
});

// ── resolve on file (Core only) ─────────────────────────────────────────────
describe("resolve/reopen on file", () => {
  beforeEach(() => {
    mockPrisma.docComment.findUnique.mockResolvedValue(
      baseComment({ targetType: "file", targetId: "file-1" }),
    );
  });

  it("allows Core to resolve file comments", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const res = (await post("resolve", "core-user")) as Response;
    expect(res.status).toBe(200);
  });

  it("denies non-Core from resolving file comments", async () => {
    const res = (await post("resolve", AUTHOR_ID)) as Response;
    expect(res.status).toBe(403);
  });
});

// ── resolve on pagedoc (maintainer only) ────────────────────────────────────
describe("resolve/reopen on pagedoc", () => {
  const MAINTAINER = "maintainer-1";

  beforeEach(() => {
    mockPrisma.docComment.findUnique.mockResolvedValue(
      baseComment({ targetType: "pagedoc", targetId: "pd-1" }),
    );
    mockPrisma.pageDoc.findUnique.mockResolvedValue({ maintainerId: MAINTAINER });
  });

  it("allows the maintainer to resolve", async () => {
    const res = (await post("resolve", MAINTAINER)) as Response;
    expect(res.status).toBe(200);
  });

  it("denies non-maintainer", async () => {
    const res = (await post("resolve", OTHER_ID)) as Response;
    expect(res.status).toBe(403);
  });
});

// ── DELETE ───────────────────────────────────────────────────────────────────
describe("DELETE", () => {
  it("allows author to delete their own doc comment", async () => {
    const res = (await del(AUTHOR_ID)) as Response;
    expect(res.status).toBe(200);
    expect(mockPrisma.docComment.delete).toHaveBeenCalledWith({ where: { id: COMMENT_ID } });
  });

  it("allows Core to delete any doc comment", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const res = (await del("core-user")) as Response;
    expect(res.status).toBe(200);
  });

  it("denies a non-author, non-Core user from deleting a doc comment", async () => {
    const res = (await del(OTHER_ID)) as Response;
    expect(res.status).toBe(403);
    expect(mockPrisma.docComment.delete).not.toHaveBeenCalled();
  });

  it("denies non-Core from deleting file comments", async () => {
    mockPrisma.docComment.findUnique.mockResolvedValue(
      baseComment({ targetType: "file", targetId: "file-1" }),
    );
    // Non-Core author — file comments are Core-only to delete
    const res = (await del(AUTHOR_ID)) as Response;
    expect(res.status).toBe(403);
  });

  it("allows Core to delete file comments", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.docComment.findUnique.mockResolvedValue(
      baseComment({ targetType: "file", targetId: "file-1" }),
    );
    const res = (await del("core-user")) as Response;
    expect(res.status).toBe(200);
  });

  it("allows pagedoc author to delete their own comment", async () => {
    mockPrisma.docComment.findUnique.mockResolvedValue(
      baseComment({ targetType: "pagedoc", targetId: "pd-1" }),
    );
    const res = (await del(AUTHOR_ID)) as Response;
    expect(res.status).toBe(200);
  });
});

// ── react / unreact ──────────────────────────────────────────────────────────
describe("react intent", () => {
  beforeEach(() => {
    vi.mocked(getPageAccess).mockResolvedValue({
      canView: true,
      canEdit: false,
      canComment: true,
      canResolve: false,
    });
    mockPrismaTyped.docCommentReaction.upsert.mockResolvedValue({});
  });

  it("upserts a reaction row for a valid emoji", async () => {
    const res = (await post("react", AUTHOR_ID, { emoji: "👍" })) as Response;
    expect(res.status).toBe(200);
    expect(mockPrismaTyped.docCommentReaction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { commentId: COMMENT_ID, userId: AUTHOR_ID, emoji: "👍" },
      }),
    );
  });

  it("rejects react with missing emoji", async () => {
    const res = (await post("react", AUTHOR_ID, {})) as Response;
    expect(res.status).toBe(400);
    expect(mockPrismaTyped.docCommentReaction.upsert).not.toHaveBeenCalled();
  });

  it("rejects react when canComment is false on a doc target", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({
      canView: true,
      canEdit: false,
      canComment: false,
      canResolve: false,
    });
    const res = (await post("react", OTHER_ID, { emoji: "👍" })) as Response;
    expect(res.status).toBe(403);
    expect(mockPrismaTyped.docCommentReaction.upsert).not.toHaveBeenCalled();
  });

  it("allows react on file/pagedoc targets without extra access check", async () => {
    mockPrisma.docComment.findUnique.mockResolvedValue(
      baseComment({ targetType: "pagedoc", targetId: "pd-1" }),
    );
    const res = (await post("react", OTHER_ID, { emoji: "❤️" })) as Response;
    expect(res.status).toBe(200);
    // getPageAccess should NOT be called for non-doc targets
    expect(getPageAccess).not.toHaveBeenCalled();
  });
});

describe("unreact intent", () => {
  beforeEach(() => {
    vi.mocked(getPageAccess).mockResolvedValue({
      canView: true,
      canEdit: false,
      canComment: true,
      canResolve: false,
    });
    mockPrismaTyped.docCommentReaction.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("deletes a reaction row for a valid emoji", async () => {
    const res = (await post("unreact", AUTHOR_ID, { emoji: "👍" })) as Response;
    expect(res.status).toBe(200);
    expect(mockPrismaTyped.docCommentReaction.deleteMany).toHaveBeenCalledWith({
      where: { commentId: COMMENT_ID, userId: AUTHOR_ID, emoji: "👍" },
    });
  });

  it("is idempotent — no error when the reaction doesn't exist", async () => {
    mockPrismaTyped.docCommentReaction.deleteMany.mockResolvedValue({ count: 0 });
    const res = (await post("unreact", AUTHOR_ID, { emoji: "🚀" })) as Response;
    expect(res.status).toBe(200);
  });

  it("rejects unreact with empty emoji string", async () => {
    const res = (await post("unreact", AUTHOR_ID, { emoji: "" })) as Response;
    expect(res.status).toBe(400);
    expect(mockPrismaTyped.docCommentReaction.deleteMany).not.toHaveBeenCalled();
  });
});
