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
vi.mock("~/lib/collabAuth.server", () => ({
  hydrateAuthors: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/lib/comment-events.server", () => ({
  publishCommentChange: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { getPageAccess } from "~/lib/pageAccess.server";

import { LIST_COMMENTS_TOOL, runListComments } from "~/mcp/tools/docs/comments";
import { MANAGE_COMMENT_TOOL_DEF, runManageComment } from "~/mcp/tools/docs/manage-comment";

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPageAccess).mockResolvedValue({ canComment: true, canView: true, canEdit: false } as never);
  db.page.findUnique.mockResolvedValue({ archivedAt: null, kind: "Slides" });
  db.docComment.create.mockResolvedValue({ id: "c1" });
});

describe("list_comments on a slide deck", () => {
  it("adds an optional slideId and keeps the old inputs", () => {
    const props = LIST_COMMENTS_TOOL.inputSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("slideId");
    expect(props).toHaveProperty("targetType");
    expect(LIST_COMMENTS_TOOL.inputSchema.required).toEqual(["targetType", "targetId"]);
  });

  it("filters roots to one slide's threads", async () => {
    db.docComment.findMany.mockResolvedValue([]);
    db.docComment.count.mockResolvedValue(0);
    await runListComments("u1", { targetType: "doc", targetId: "deck", slideId: "s1" });
    expect(db.docComment.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      targetType: "doc",
      targetId: "deck",
      parentId: null,
      anchor: { path: ["slideId"], equals: "s1" },
    });
  });

  it("returns the whole anchor so a client can place the thread", async () => {
    const anchor = { kind: "slide", slideId: "s1", elementId: "title" };
    db.docComment.findMany
      .mockResolvedValueOnce([{ id: "c1", parentId: null, authorId: "u2", body: "x", anchor, createdAt: new Date(), versionId: null, updatedAt: new Date(), reactions: [] }])
      .mockResolvedValueOnce([]);
    db.docComment.count.mockResolvedValue(1);
    const out = await runListComments("u1", { targetType: "doc", targetId: "deck" });
    expect(out.comments[0].anchor).toEqual(anchor);
  });

  it("still refuses someone without comment access", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canComment: false, canView: false, canEdit: false } as never);
    await expect(runListComments("u1", { targetType: "doc", targetId: "deck", slideId: "s1" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("manage_comment with slide anchors", () => {
  it("keeps the old anchor fields and adds the slide ones", () => {
    const anchor = (MANAGE_COMMENT_TOOL_DEF.inputSchema.properties as any).anchor.properties;
    expect(Object.keys(anchor)).toEqual(expect.arrayContaining(["from", "to", "kind", "slideId", "elementId", "x", "y"]));
  });

  it("pins a comment to an element on a deck", async () => {
    const anchor = { kind: "slide", slideId: "s1", elementId: "title", x: 0.2, y: 0.4 };
    await expect(runManageComment("u1", { action: "create", targetType: "doc", targetId: "deck", body: "Shorter?", anchor })).resolves.toEqual({ id: "c1" });
    expect(db.docComment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ anchor }) }));
  });

  it("still takes an inline blocknote marker", async () => {
    const anchor = { kind: "blocknote" };
    await runManageComment("u1", { action: "create", targetType: "doc", targetId: "deck", body: "hi", anchor });
    expect(db.docComment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ anchor }) }));
  });

  it("rejects a legacy {from, to} range", async () => {
    await expect(runManageComment("u1", { action: "create", targetType: "doc", targetId: "deck", body: "hi", anchor: { from: "a", to: "b" } })).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ["a missing slide id", { kind: "slide" }],
    ["a point off the slide", { kind: "slide", slideId: "s1", x: 3, y: 0.1 }],
    ["an unknown kind", { kind: "pin", slideId: "s1" }],
  ])("rejects %s and writes nothing", async (_n, anchor) => {
    await expect(runManageComment("u1", { action: "create", targetType: "doc", targetId: "deck", body: "hi", anchor })).rejects.toMatchObject({ status: 400 });
    expect(db.docComment.create).not.toHaveBeenCalled();
  });

  it("rejects a slide anchor on a page that is not a deck", async () => {
    db.page.findUnique.mockResolvedValue({ archivedAt: null, kind: "Doc" });
    await expect(
      runManageComment("u1", { action: "create", targetType: "doc", targetId: "page", body: "hi", anchor: { kind: "slide", slideId: "s1" } }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("still needs comment access", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canComment: false, canView: true, canEdit: false } as never);
    await expect(
      runManageComment("u1", { action: "create", targetType: "doc", targetId: "deck", body: "hi", anchor: { kind: "slide", slideId: "s1" } }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
