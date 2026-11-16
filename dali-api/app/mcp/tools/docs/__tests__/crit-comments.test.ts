import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpInvalidError extends Error {}
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const missing = (spec[action] ?? []).filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { requireForAction, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});
vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMember: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/collabAuth.server", () => ({ hydrateAuthors: vi.fn().mockResolvedValue([]) }));
vi.mock("~/lib/comment-events.server", () => ({ publishCommentChange: vi.fn() }));
vi.mock("~/lib/reactions.server", () => ({ addReaction: vi.fn().mockResolvedValue(null), commentReactionStore: vi.fn(() => ({ remove: vi.fn() })) }));
vi.mock("~/lib/doc-comments.server", () => ({
  CommentCreateError: class extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
  createDocComment: vi.fn().mockResolvedValue({ id: "c1" }),
}));
vi.mock("~/lib/crit-comments.server", () => ({ loadCritTarget: vi.fn(), critHiddenAuthorId: vi.fn().mockResolvedValue(null), critActorIsAnonymous: vi.fn().mockResolvedValue(false) }));

import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { addReaction } from "~/lib/reactions.server";
import { createDocComment } from "~/lib/doc-comments.server";
import { loadCritTarget } from "~/lib/crit-comments.server";
import { LIST_COMMENTS_TOOL, runListComments } from "~/mcp/tools/docs/comments";
import { MANAGE_COMMENT_TOOL_DEF, runManageComment } from "~/mcp/tools/docs/manage-comment";

const db = prisma as any;
const target = (canModerate = false) => ({ id: "s1", pageId: "hub1", kind: "image", title: "Logo", authorId: "poster", canModerate });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(loadCritTarget).mockResolvedValue(target() as any);
  db.docComment.findMany.mockResolvedValue([]);
  db.docComment.count.mockResolvedValue(0);
  db.docComment.findUnique.mockResolvedValue({ id: "c1", authorId: "u1", targetType: "crit", targetId: "s1", parentId: null });
  db.docComment.delete.mockResolvedValue({});
});

describe("crit targets in the MCP schema", () => {
  it("accepts the crit target and the image anchor", () => {
    expect(LIST_COMMENTS_TOOL.inputSchema.properties.targetType.enum).toContain("crit");
    expect(MANAGE_COMMENT_TOOL_DEF.inputSchema.properties.targetType.enum).toContain("crit");
    expect(MANAGE_COMMENT_TOOL_DEF.inputSchema.properties.anchor.properties.kind.enum).toContain("image");
  });
});

describe("list_comments on a crit post", () => {
  it("reads for someone who can see the wall, and refuses anyone else", async () => {
    await expect(runListComments("u1", { targetType: "crit", targetId: "s1" })).resolves.toMatchObject({ comments: [] });
    vi.mocked(loadCritTarget).mockResolvedValue(null);
    await expect(runListComments("u1", { targetType: "crit", targetId: "s1" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("manage_comment on a crit post", () => {
  it("creates a pinned comment with the image anchor", async () => {
    await runManageComment("u1", { action: "create", targetType: "crit", targetId: "s1", body: "hi", anchor: { kind: "image", x: 0.3, y: 0.4 } });
    expect(createDocComment).toHaveBeenCalledWith(expect.objectContaining({ targetType: "crit", anchor: { kind: "image", x: 0.3, y: 0.4 } }));
  });

  it("refuses to create when the wall isn't visible, and rejects a bad pin", async () => {
    await expect(runManageComment("u1", { action: "create", targetType: "crit", targetId: "s1", body: "hi", anchor: { kind: "image", x: 2, y: 0.4 } })).rejects.toMatchObject({ status: 400 });
    vi.mocked(loadCritTarget).mockResolvedValue(null);
    await expect(runManageComment("u1", { action: "create", targetType: "crit", targetId: "s1", body: "hi" })).rejects.toMatchObject({ status: 403 });
    expect(createDocComment).not.toHaveBeenCalled();
  });

  it("deletes for the author, Core or a lead, but not the poster or another member", async () => {
    await runManageComment("u1", { action: "delete", commentId: "c1" });
    expect(db.docComment.delete).toHaveBeenCalledTimes(1);
    db.docComment.delete.mockClear();
    await expect(runManageComment("poster", { action: "delete", commentId: "c1" })).rejects.toMatchObject({ status: 403 });
    await expect(runManageComment("u2", { action: "delete", commentId: "c1" })).rejects.toMatchObject({ status: 403 });
    vi.mocked(loadCritTarget).mockResolvedValue(target(true) as any);
    await runManageComment("lead", { action: "delete", commentId: "c1" });
    expect(db.docComment.delete).toHaveBeenCalledTimes(1);
  });

  it("reacts only for someone who can see the wall", async () => {
    await runManageComment("u2", { action: "react", commentId: "c1", emoji: "👍" });
    expect(addReaction).toHaveBeenCalledTimes(1);
    vi.mocked(loadCritTarget).mockResolvedValue(null);
    await expect(runManageComment("u2", { action: "react", commentId: "c1", emoji: "👍" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("manage_comment edit keeps @mention chips", () => {
  const chip = { type: "mention", userId: "u3", label: "ada" };
  it("rebuilds the chips for the new text", async () => {
    db.docComment.findUnique.mockResolvedValue({ id: "c1", authorId: "u1", targetType: "crit", targetId: "s1", parentId: null, bodyJson: [{ type: "text", text: "hi " }, chip] });
    db.docComment.update.mockResolvedValue({});
    await runManageComment("u1", { action: "edit", commentId: "c1", body: "hello @ada" });
    expect(db.docComment.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { body: "hello @ada", bodyJson: [{ type: "text", text: "hello " }, chip] } });
  });
  it("leaves a plain comment's bodyJson alone", async () => {
    db.docComment.update.mockResolvedValue({});
    await runManageComment("u1", { action: "edit", commentId: "c1", body: "hello" });
    expect(db.docComment.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { body: "hello" } });
  });
});
