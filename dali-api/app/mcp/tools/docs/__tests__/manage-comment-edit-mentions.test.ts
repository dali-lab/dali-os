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

import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { runManageComment } from "~/mcp/tools/docs/manage-comment";

const db = prisma as any;
const chip = { type: "mention", userId: "u3", label: "ada" };
const row = (bodyJson?: unknown) => ({ id: "c1", authorId: "u1", targetType: "pagedoc", targetId: "p1", parentId: null, bodyJson });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  db.docComment.update.mockResolvedValue({});
});

describe("manage_comment edit keeps @mention chips", () => {
  it("rebuilds the chips for the new text", async () => {
    db.docComment.findUnique.mockResolvedValue(row([{ type: "text", text: "hi " }, chip]));
    await runManageComment("u1", { action: "edit", commentId: "c1", body: "hello @ada" });
    expect(db.docComment.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { body: "hello @ada", bodyJson: [{ type: "text", text: "hello " }, chip] } });
  });
  it("leaves a plain comment's bodyJson alone", async () => {
    db.docComment.findUnique.mockResolvedValue(row());
    await runManageComment("u1", { action: "edit", commentId: "c1", body: "hello" });
    expect(db.docComment.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { body: "hello" } });
  });
});
