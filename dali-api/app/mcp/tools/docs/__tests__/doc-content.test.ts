import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    page: { findUnique: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/collabAuth", () => ({ authorizeCollabDoc: vi.fn() }));
vi.mock("~/lib/blog-post.server", () => ({ findBlogPost: vi.fn() }));
vi.mock("../blog-posts", () => ({ requireViewer: vi.fn() }));
vi.mock("../../set-page-content", () => ({ loadEditablePage: vi.fn() }));
vi.mock("~/collab/edit.server", () => {
  class DocEditError extends Error {
    readonly opIndex: number | null;
    readonly blockId?: string;
    readonly current?: { block: unknown; hash: string; treeHash?: string };
    constructor(
      readonly code: string,
      message: string,
      details: { opIndex?: number | null; blockId?: string; current?: { block: unknown; hash: string; treeHash?: string } } = {},
    ) {
      super(message);
      this.opIndex = details.opIndex ?? null;
      this.blockId = details.blockId;
      this.current = details.current;
    }
  }
  return {
    DocEditError,
    applyDocOps: vi.fn(),
    outlineDoc: vi.fn(),
    getDocBlocks: vi.fn(),
    blockHash: (b: { type: string; props: unknown; content: unknown }) =>
      JSON.stringify([b.type, b.props, b.content]),
  };
});
vi.mock("~/collab/agent-presence.server", () => {
  class AgentBlockNotFoundError extends Error {
    readonly code = "BLOCK_NOT_FOUND";
    constructor(readonly blockId: string) {
      super(`Block '${blockId}' is not in the document`);
    }
  }
  return {
    AgentBlockNotFoundError,
    agentAnnouncer: vi.fn(),
    announceAgent: vi.fn(),
    docViewerCount: vi.fn(),
    pagePresenceRoom: (id: string) => `presence:doc:${id}`,
    pointAgent: vi.fn(),
  };
});

import { prisma } from "~/lib/db.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { authorizeCollabDoc } from "~/lib/collabAuth";
import { findBlogPost } from "~/lib/blog-post.server";
import { requireViewer } from "../blog-posts";
import { loadEditablePage } from "../../set-page-content";
import { DocEditError, applyDocOps, getDocBlocks, outlineDoc } from "~/collab/edit.server";
import {
  AgentBlockNotFoundError,
  agentAnnouncer,
  announceAgent,
  docViewerCount,
  pointAgent,
} from "~/collab/agent-presence.server";
import {
  DOC_CONTENT_TOOLS,
  runEditContent,
  runGetContentBlocks,
  runOutlineContent,
  runPointAtContent,
} from "../doc-content";

const db = prisma as any;
const ctx = { user: { id: "me" }, scopes: ["mcp:write"], request: new Request("http://x") } as any;
const PAGE = { type: "page" as const, id: "pg1" };
const POST = { type: "blogPost" as const, id: "bp1" };
const announce = vi.fn();
const EDITED = { touched: ["b1"], hashes: { b1: "h2" }, treeHashes: {}, range: { start: 1, end: 2 }, results: [{ op: "update", blockIds: ["b1"] }] };
const OUTLINE_ROW = { type: "paragraph", depth: 0, parentId: null, preview: "", childCount: 0, hash: "h" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true } as any);
  db.page.findUnique.mockResolvedValue({ id: "pg1", kind: "FreeForm", contentDocId: null });
  db.user.findMany.mockResolvedValue([]);
  vi.mocked(loadEditablePage).mockResolvedValue({ id: "pg1", contentDocId: null } as any);
  vi.mocked(requireViewer).mockResolvedValue({ id: "me", core: false });
  vi.mocked(findBlogPost).mockResolvedValue({ post: { id: "bp1" }, canEdit: true, canApprove: false } as any);
  vi.mocked(agentAnnouncer).mockResolvedValue(announce);
  vi.mocked(docViewerCount).mockReturnValue(2);
  vi.mocked(applyDocOps).mockImplementation(async (_n, _o, _a, opts) => {
    opts?.onApplied?.(EDITED);
    return EDITED;
  });
});

function engineOps() {
  return vi.mocked(applyDocOps).mock.calls[0]![1] as any[];
}

describe("registration", () => {
  it("registers four tools with read and write scopes", () => {
    expect(DOC_CONTENT_TOOLS.map((t) => [t.def.name, t.def.requiredScope])).toEqual([
      ["outline_content", "mcp:read"],
      ["get_content_blocks", "mcp:read"],
      ["edit_content", "mcp:write"],
      ["point_at_content", "mcp:write"],
    ]);
  });
});

describe("feature flag", () => {
  it("refuses every tool while the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    await expect(runOutlineContent(ctx, { target: PAGE })).rejects.toMatchObject({ status: 403 });
    await expect(runEditContent(ctx, { target: PAGE, ops: [{ op: "delete", blockId: "b1", expectedHash: "h" }] })).rejects.toMatchObject({ status: 403 });
    await expect(runPointAtContent(ctx, { target: PAGE, blockId: "b1" })).rejects.toMatchObject({ status: 403 });
    expect(applyDocOps).not.toHaveBeenCalled();
  });
});

describe("access", () => {
  it("reads a page only when the caller may open its doc", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: false } as any);
    await expect(runOutlineContent(ctx, { target: PAGE })).rejects.toMatchObject({ status: 403 });
    expect(authorizeCollabDoc).toHaveBeenCalledWith("me", "doc:pg1:body");
  });

  it("reports a missing page and refuses non-FreeForm pages", async () => {
    db.page.findUnique.mockResolvedValueOnce(null);
    await expect(runOutlineContent(ctx, { target: PAGE })).rejects.toMatchObject({ status: 404 });
    db.page.findUnique.mockResolvedValueOnce({ id: "pg1", kind: "Whiteboard", contentDocId: null });
    await expect(runOutlineContent(ctx, { target: PAGE })).rejects.toMatchObject({ status: 400 });
  });

  it("checks page edit rights through loadEditablePage for writes", async () => {
    vi.mocked(loadEditablePage).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(runEditContent(ctx, { target: PAGE, ops: [{ op: "delete", blockId: "b1", expectedHash: "h" }] })).rejects.toMatchObject({ status: 403 });
    expect(applyDocOps).not.toHaveBeenCalled();
  });

  it("uses a page's custom doc name when it has one", async () => {
    vi.mocked(loadEditablePage).mockResolvedValue({ id: "pg1", contentDocId: "seed:doc" } as any);
    await runEditContent(ctx, { target: PAGE, ops: [{ op: "delete", blockId: "b1", expectedHash: "h" }] });
    expect(vi.mocked(applyDocOps).mock.calls[0]![0]).toBe("seed:doc");
  });

  it("reads a blog post the viewer can see and edits only their own", async () => {
    vi.mocked(outlineDoc).mockResolvedValue({ blocks: [] });
    await runOutlineContent(ctx, { target: POST });
    expect(outlineDoc).toHaveBeenCalledWith("blogPost:bp1:body");

    vi.mocked(findBlogPost).mockResolvedValue({ post: { id: "bp1" }, canEdit: false, canApprove: false } as any);
    await expect(runEditContent(ctx, { target: POST, ops: [{ op: "delete", blockId: "b1", expectedHash: "h" }] })).rejects.toMatchObject({ status: 403 });

    vi.mocked(findBlogPost).mockResolvedValue(null);
    await expect(runOutlineContent(ctx, { target: POST })).rejects.toMatchObject({ status: 404 });
  });
});

describe("outline_content", () => {
  it("pages the outline and announces a read on pages", async () => {
    const blocks = Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, type: "paragraph", depth: 0, parentId: null, preview: "", childCount: 0, hash: "h" }));
    vi.mocked(outlineDoc).mockResolvedValue({ blocks });
    const first = await runOutlineContent(ctx, { target: PAGE, limit: 2 });
    expect(first.blocks.map((b) => b.id)).toEqual(["b0", "b1"]);
    expect(first.page.hasMore).toBe(true);
    const second = await runOutlineContent(ctx, { target: PAGE, limit: 2, cursor: first.page.nextCursor! });
    expect(second.blocks.map((b) => b.id)).toEqual(["b2"]);
    expect(announceAgent).toHaveBeenCalledWith({ action: "reading", presenceRoom: "presence:doc:pg1" });
  });
});

describe("get_content_blocks", () => {
  const para = { id: "b1", type: "paragraph", props: { backgroundColor: "default", textColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "Hello", styles: {} }], children: [] };
  const callout = { id: "c1", type: "callout", props: { emoji: "💡" }, content: [{ type: "text", text: "Note", styles: {} }], children: [] };

  it("returns Markdown, and JSON for blocks Markdown can't hold", async () => {
    vi.mocked(getDocBlocks).mockResolvedValue([{ block: para, hash: "h1" }, { block: callout, hash: "h2" }] as any);
    const { blocks } = await runGetContentBlocks(ctx, { target: PAGE, blockIds: ["b1", "c1"] });
    expect(blocks[0]).toMatchObject({ id: "b1", hash: "h1", markdown: "Hello\n", markdownSafe: true });
    expect(blocks[0]).not.toHaveProperty("json");
    expect(blocks[1]).toMatchObject({ id: "c1", markdownSafe: false, json: callout });
  });

  it("passes through the tree hash of blocks with children", async () => {
    const parent = { ...para, children: [{ ...para, id: "c1" }] };
    vi.mocked(getDocBlocks).mockResolvedValue([{ block: parent, hash: "h1", treeHash: "t1" }, { block: para, hash: "h2" }] as any);
    const md = await runGetContentBlocks(ctx, { target: PAGE });
    expect(md.blocks[0]).toMatchObject({ hash: "h1", treeHash: "t1" });
    expect(md.blocks[1]).not.toHaveProperty("treeHash");
    const json = await runGetContentBlocks(ctx, { target: PAGE, format: "json" });
    expect(json.blocks[0]).toMatchObject({ hash: "h1", treeHash: "t1" });
  });

  it("returns JSON only when asked", async () => {
    vi.mocked(getDocBlocks).mockResolvedValue([{ block: para, hash: "h1" }] as any);
    const { blocks } = await runGetContentBlocks(ctx, { target: PAGE, format: "json" });
    expect(blocks[0]).toEqual({ id: "b1", type: "paragraph", hash: "h1", json: para });
  });

  it("maps a missing block to not found", async () => {
    vi.mocked(getDocBlocks).mockRejectedValue(new (DocEditError as any)("BLOCK_NOT_FOUND", "Block 'zz' is not in the document"));
    await expect(runGetContentBlocks(ctx, { target: PAGE, blockIds: ["zz"] })).rejects.toMatchObject({ status: 404, message: expect.stringMatching(/^BLOCK_NOT_FOUND/) });
  });
});

describe("edit_content", () => {
  it("passes replace_text straight through", async () => {
    await runEditContent(ctx, { target: PAGE, ops: [{ op: "replace_text", blockId: "b1", expectedHash: "h", find: "Nov 12", replace: "Nov 14" }] });
    expect(engineOps()).toEqual([{ op: "replace_text", blockId: "b1", expectedHash: "h", find: "Nov 12", replace: "Nov 14" }]);
  });

  it("parses insert Markdown into blocks", async () => {
    await runEditContent(ctx, { target: PAGE, ops: [{ op: "insert", position: { after: "b1" }, markdown: "# Title\n\nBody" }] });
    const [op] = engineOps();
    expect(op.position).toEqual({ after: "b1" });
    expect(op.blocks.map((b: any) => b.type)).toEqual(["heading", "paragraph"]);
  });

  it("requires exactly one position", async () => {
    await expect(runEditContent(ctx, { target: PAGE, ops: [{ op: "insert", position: { after: "a", before: "b" }, markdown: "x" }] })).rejects.toThrow(/exactly one of/);
    await expect(runEditContent(ctx, { target: PAGE, ops: [{ op: "move", blockId: "b1", expectedHash: "h", position: {} }] })).rejects.toThrow(/exactly one of/);
    await expect(runEditContent(ctx, { target: PAGE, ops: [{ op: "insert", markdown: "x" }] })).rejects.toThrow(/needs position/);
  });

  it("turns update Markdown into one block's content", async () => {
    await runEditContent(ctx, { target: PAGE, ops: [{ op: "update", blockId: "b1", expectedHash: "h", markdown: "## New heading" }] });
    const [op] = engineOps();
    expect(op.block.type).toBe("heading");
    expect(op.block.content[0].text).toBe("New heading");
    expect(op).not.toHaveProperty("children");
  });

  it("leaves out props Markdown can't express, so colour and alignment stay", async () => {
    await runEditContent(ctx, { target: PAGE, ops: [{ op: "update", blockId: "b1", expectedHash: "h", markdown: "Plain words" }] });
    expect(engineOps()[0].block).toEqual({ type: "paragraph", content: [{ type: "text", text: "Plain words", styles: {} }] });
    vi.mocked(applyDocOps).mockClear();
    await runEditContent(ctx, { target: PAGE, ops: [{ op: "update", blockId: "b1", expectedHash: "h", markdown: "### Smaller" }] });
    expect(engineOps()[0].block.props).toEqual({ level: 3 });
  });

  it("passes expectedTreeHash to delete, move and update only", async () => {
    await runEditContent(ctx, {
      target: PAGE,
      ops: [
        { op: "delete", blockId: "a", expectedHash: "h", expectedTreeHash: "t" },
        { op: "move", blockId: "b", expectedHash: "h", expectedTreeHash: "t", position: { end: true } },
        { op: "update", blockId: "c", expectedHash: "h", expectedTreeHash: "t", markdown: "x" },
        { op: "replace_text", blockId: "d", expectedHash: "h", expectedTreeHash: "t", find: "a", replace: "b" },
        { op: "delete", blockId: "e", expectedHash: "h" },
      ],
    });
    const ops = engineOps();
    expect(ops.map((o) => o.expectedTreeHash)).toEqual(["t", "t", "t", undefined, undefined]);
    expect(ops[4]).not.toHaveProperty("expectedTreeHash");
  });

  it("refuses update Markdown that makes several blocks", async () => {
    await expect(runEditContent(ctx, { target: PAGE, ops: [{ op: "update", blockId: "b1", expectedHash: "h", markdown: "one\n\ntwo" }] })).rejects.toThrow(/exactly one block/);
    expect(applyDocOps).not.toHaveBeenCalled();
  });

  it("refuses markdown and blocks together", async () => {
    await expect(runEditContent(ctx, { target: PAGE, ops: [{ op: "insert", position: { end: true }, markdown: "x", blocks: [] }] })).rejects.toThrow(/not both/);
  });

  it("builds table row and cell content from Markdown", async () => {
    db.user.findMany.mockResolvedValue([{ id: "u1" }]);
    await runEditContent(ctx, {
      target: PAGE,
      ops: [
        { op: "insert_row", blockId: "t1", expectedHash: "h", cells: ["Demo", "[@Ana](/members/u1)", ""] },
        { op: "set_cell", blockId: "t1", row: 0, col: 1, markdown: "one<br>two" },
        { op: "delete_row", blockId: "t1", index: 2 },
      ],
    });
    const [insertRow, setCell, deleteRow] = engineOps();
    expect(insertRow).not.toHaveProperty("index");
    expect(insertRow.cells[1][0]).toMatchObject({ type: "mention", props: { id: "u1", label: "Ana" } });
    expect(insertRow.cells[2]).toEqual([]);
    expect(setCell.content[0].text).toBe("one\ntwo");
    expect(deleteRow).toMatchObject({ op: "delete_row", index: 2 });
  });

  it("checks mentions in JSON blocks and reports unknown ones", async () => {
    const result = await runEditContent(ctx, {
      target: PAGE,
      ops: [{ op: "insert", position: { end: true }, blocks: [{ type: "paragraph", content: [{ type: "mention", props: { id: "ghost", label: "Ghost" } }] } as any] }],
    });
    expect(engineOps()[0].blocks[0].content).toEqual([{ type: "text", text: "@Ghost", styles: {} }]);
    expect(result.warnings).toEqual(['No member with id ghost: "Ghost" was written as plain text']);
  });

  it("names the op that's missing a field", async () => {
    await expect(runEditContent(ctx, { target: PAGE, ops: [{ op: "delete", expectedHash: "h" }] })).rejects.toThrow("ops[0] (delete) needs blockId");
    await expect(runEditContent(ctx, { target: PAGE, ops: [{ op: "set_cell", blockId: "t", row: 0, col: 0 }] })).rejects.toThrow("ops[0] (set_cell) needs markdown");
  });

  it("announces the touched blocks and caret once applied", async () => {
    await runEditContent(ctx, { target: PAGE, ops: [{ op: "delete", blockId: "b9", expectedHash: "h" }] });
    expect(announce).toHaveBeenCalledWith({
      action: "editing",
      docRoom: "doc:pg1:body",
      presenceRoom: "presence:doc:pg1",
      range: EDITED.range,
      touched: ["b1"],
    });
  });

  it("returns new hashes and who saw it, and marks the page edited", async () => {
    const result = await runEditContent(ctx, { target: PAGE, ops: [{ op: "delete", blockId: "b9", expectedHash: "h" }] });
    expect(result).toMatchObject({ hashes: { b1: "h2" }, seenBy: 2, results: EDITED.results });
    expect(result).not.toHaveProperty("warnings");
    expect(result).not.toHaveProperty("treeHashes");
    expect(db.page.update).toHaveBeenCalledWith({ where: { id: "pg1" }, data: { lastEditedById: "me" } });
  });

  it("reports how many people had it open when the edit landed, or null without a live doc", async () => {
    vi.mocked(applyDocOps).mockImplementation(async (_n, _o, _a, opts) => {
      vi.mocked(docViewerCount).mockReturnValue(4);
      opts?.onApplied?.(EDITED);
      vi.mocked(docViewerCount).mockReturnValue(0);
      return EDITED;
    });
    expect((await runEditContent(ctx, { target: PAGE, ops: [{ op: "delete", blockId: "b9", expectedHash: "h" }] })).seenBy).toBe(4);

    vi.mocked(applyDocOps).mockResolvedValue(EDITED);
    expect((await runEditContent(ctx, { target: PAGE, ops: [{ op: "delete", blockId: "b9", expectedHash: "h" }] })).seenBy).toBeNull();
  });

  it("returns tree hashes when touched blocks have children", async () => {
    vi.mocked(applyDocOps).mockResolvedValue({ ...EDITED, treeHashes: { b1: "t2" } });
    const result = await runEditContent(ctx, { target: PAGE, ops: [{ op: "delete", blockId: "b9", expectedHash: "h" }] });
    expect(result.treeHashes).toEqual({ b1: "t2" });
  });

  it("still reports success when marking the page edited fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.page.update.mockRejectedValueOnce(new Error("db blip"));
    const result = await runEditContent(ctx, { target: PAGE, ops: [{ op: "delete", blockId: "b9", expectedHash: "h" }] });
    expect(result.hashes).toEqual({ b1: "h2" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("lastEditedById"), expect.any(Error));
  });

  it("doesn't touch the page table for blog posts", async () => {
    await runEditContent(ctx, { target: POST, ops: [{ op: "delete", blockId: "b9", expectedHash: "h" }] });
    expect(vi.mocked(applyDocOps).mock.calls[0]![0]).toBe("blogPost:bp1:body");
    expect(db.page.update).not.toHaveBeenCalled();
    expect(announce.mock.calls[0]![0].presenceRoom).toBeUndefined();
  });

  it("returns the current block and hash on BLOCK_CHANGED", async () => {
    vi.mocked(applyDocOps).mockRejectedValue(
      new (DocEditError as any)("BLOCK_CHANGED", "Block 'b1' changed since you read it", {
        opIndex: 1,
        current: { block: { id: "b1", type: "paragraph" }, hash: "fresh", treeHash: "fresh-tree" },
      }),
    );
    const err = await runEditContent(ctx, { target: PAGE, ops: [{ op: "delete", blockId: "b1", expectedHash: "old" }] }).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/^BLOCK_CHANGED \(ops\[1\]\)/);
    expect(err.message).toContain("Current hash: fresh");
    expect(err.message).toContain("Current treeHash: fresh-tree");
    expect(err.message).toContain('"id":"b1"');
    expect(db.page.update).not.toHaveBeenCalled();
  });

  it("maps a missing block to not found", async () => {
    vi.mocked(applyDocOps).mockRejectedValue(new (DocEditError as any)("BLOCK_NOT_FOUND", "Block 'zz' is not in the document", { opIndex: 0 }));
    await expect(runEditContent(ctx, { target: PAGE, ops: [{ op: "delete", blockId: "zz", expectedHash: "h" }] })).rejects.toMatchObject({ status: 404 });
  });
});

describe("point_at_content", () => {
  beforeEach(() => {
    vi.mocked(outlineDoc).mockResolvedValue({ blocks: ["b1", "b2", "zz"].map((id) => ({ id, ...OUTLINE_ROW })) });
  });

  it("checks the blocks exist before pointing, even when the doc isn't open here", async () => {
    await expect(runPointAtContent(ctx, { target: PAGE, blockId: "ghost" })).rejects.toMatchObject({
      status: 404,
      message: expect.stringMatching(/^BLOCK_NOT_FOUND/),
    });
    await expect(runPointAtContent(ctx, { target: PAGE, blockId: "b1", selectTo: { blockId: "ghost2" } })).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("ghost2"),
    });
    expect(outlineDoc).toHaveBeenCalledWith("doc:pg1:body");
    expect(pointAgent).not.toHaveBeenCalled();
  });

  it("points and reports who saw it", async () => {
    vi.mocked(pointAgent).mockReturnValue({ seen: 3 });
    const result = await runPointAtContent(ctx, { target: PAGE, blockId: "b1", offset: 4, selectTo: { at: "end" } });
    expect(pointAgent).toHaveBeenCalledWith({
      docRoom: "doc:pg1:body",
      presenceRoom: "presence:doc:pg1",
      blockId: "b1",
      offset: 4,
      selectTo: { at: "end" },
    });
    expect(result).toEqual({ target: PAGE, seenBy: 3 });
  });

  it("says when nobody has it open", async () => {
    vi.mocked(pointAgent).mockReturnValue({ seen: 0 });
    const result = await runPointAtContent(ctx, { target: PAGE, blockId: "b1" });
    expect(result.note).toMatch(/Nobody has it open/);
  });

  it("maps an unknown block to not found", async () => {
    vi.mocked(pointAgent).mockImplementation(() => {
      throw new (AgentBlockNotFoundError as any)("zz");
    });
    await expect(runPointAtContent(ctx, { target: PAGE, blockId: "zz" })).rejects.toMatchObject({ status: 404 });
  });

  it("needs edit rights", async () => {
    vi.mocked(loadEditablePage).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(runPointAtContent(ctx, { target: PAGE, blockId: "b1" })).rejects.toMatchObject({ status: 403 });
    expect(pointAgent).not.toHaveBeenCalled();
  });
});
