import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const findUnique = vi.fn();
vi.mock("~/lib/db.server", () => ({ prisma: { collabDocument: { findUnique } } }));
const getCollabServer = vi.fn();
vi.mock("../server", () => ({ getCollabServer }));
const storeDocument = vi.fn();
const maybeSnapshot = vi.fn();
vi.mock("../persistence", () => ({ storeDocument, maybeSnapshot }));
vi.mock("../agent-presence.server", () => ({
  agentAnnouncer: vi.fn(async () => () => {}),
  bodyTexts: () => [],
  changedTextRange: () => null,
}));

const { blocksToFragment, fragmentToBlocks } = await import("../blocknote-server");
const { stripCommentFormats } = await import("../comment-formats");
const {
  DocEditError,
  applyDocOps,
  applyOpsToDoc,
  blockHash,
  getDocBlocks,
  outlineDoc,
} = await import("../edit.server");
type DocBlock = import("../blocknote-server").DocBlock;
type DocOp = import("../edit.server").DocOp;

const BASE = { backgroundColor: "default", textColor: "default", textAlignment: "left" };
const COMMENT = "comment--t1";
const COMMENT_VALUE = { threadId: "t1", orphan: false };

function para(id: string, text: string, children: DocBlock[] = []): DocBlock {
  return { id, type: "paragraph", props: BASE, content: text ? [{ type: "text", text, styles: {} }] : [], children };
}

function cell(content: DocBlock["content"]) {
  return { type: "tableCell" as const, content: content as never };
}

function table(id: string): DocBlock {
  return {
    id,
    type: "table",
    props: { textColor: "default" },
    content: {
      type: "tableContent",
      headerRows: 1,
      rows: [
        { cells: [cell([{ type: "text", text: "Name", styles: {} }]), cell([{ type: "text", text: "Owner", styles: {} }])] },
        {
          cells: [
            cell([{ type: "text", text: "Launch", styles: {} }]),
            cell([{ type: "mention", props: { id: "u1", label: "Kiran" } }]),
          ],
        },
      ],
    },
    children: [],
  };
}

function makeDoc(blocks: DocBlock[]): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => blocksToFragment(blocks, doc.getXmlFragment("blocknote")));
  return doc;
}

function read(doc: Y.Doc): DocBlock[] {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
  const fragment = clone.getXmlFragment("blocknote");
  clone.transact(() => stripCommentFormats(fragment));
  const blocks = fragmentToBlocks(fragment);
  clone.destroy();
  return blocks;
}

function find(blocks: DocBlock[], id: string): DocBlock | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    const inner = find(block.children, id);
    if (inner) return inner;
  }
  return undefined;
}

function hashOf(doc: Y.Doc, id: string): string {
  return blockHash(find(read(doc), id)!);
}

function container(doc: Y.Doc, id: string): Y.XmlElement {
  const walk = (node: Y.XmlElement | Y.XmlFragment): Y.XmlElement | null => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.getAttribute("id") === id) return child;
      const inner = walk(child);
      if (inner) return inner;
    }
    return null;
  };
  return walk(doc.getXmlFragment("blocknote"))!;
}

function firstText(el: Y.XmlElement): Y.XmlText {
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) return child;
    if (child instanceof Y.XmlElement) {
      const inner = firstText(child);
      if (inner) return inner;
    }
  }
  return undefined as unknown as Y.XmlText;
}

function comment(doc: Y.Doc, id: string, from: number, length: number) {
  firstText(container(doc, id).get(0) as Y.XmlElement).format(from, length, { [COMMENT]: COMMENT_VALUE });
}

function delta(doc: Y.Doc, id: string) {
  return firstText(container(doc, id).get(0) as Y.XmlElement).toDelta();
}

function text(block: DocBlock | undefined): string {
  return ((block?.content as Array<{ text?: string; props?: { label?: string } }>) ?? [])
    .map((c) => c.text ?? `@${c.props?.label}`)
    .join("");
}

function attempt(fn: () => unknown): InstanceType<typeof DocEditError> {
  try {
    fn();
  } catch (err) {
    return err as InstanceType<typeof DocEditError>;
  }
  throw new Error("expected a DocEditError");
}

beforeEach(() => {
  vi.clearAllMocks();
  getCollabServer.mockReturnValue(null);
  findUnique.mockResolvedValue(null);
  storeDocument.mockResolvedValue({ state: new Uint8Array(), plainText: "" });
});

describe("blockHash", () => {
  it("is 12 hex chars and ignores key order", () => {
    const a = blockHash({ type: "paragraph", props: { a: 1, b: 2 }, content: [{ type: "text", text: "x", styles: {} }] });
    const b = blockHash({ type: "paragraph", props: { b: 2, a: 1 }, content: [{ styles: {}, text: "x", type: "text" }] });
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(a).toBe(b);
  });

  it("excludes children", () => {
    expect(blockHash(para("a", "x", [para("c", "child")]))).toBe(blockHash(para("a", "x")));
    expect(blockHash(para("a", "x"))).not.toBe(blockHash(para("a", "y")));
  });

  it("does not change when a child or sibling is edited", () => {
    const doc = makeDoc([para("a", "parent", [para("c", "child")]), para("s", "sibling")]);
    const before = hashOf(doc, "a");
    applyOpsToDoc(doc, [
      { op: "replace_text", blockId: "c", expectedHash: hashOf(doc, "c"), find: "child", replace: "kid" },
      { op: "replace_text", blockId: "s", expectedHash: hashOf(doc, "s"), find: "sibling", replace: "sib" },
    ]);
    expect(text(find(read(doc), "c"))).toBe("kid");
    expect(hashOf(doc, "a")).toBe(before);
  });
});

describe("outlineDoc and getDocBlocks", () => {
  const long = "word ".repeat(30).trim();
  const persist = (doc: Y.Doc) => findUnique.mockResolvedValue({ state: Y.encodeStateAsUpdate(doc) });

  it("outlines the persisted doc depth first with previews, hashes and table shape", async () => {
    const doc = makeDoc([para("a", long, [para("c", "child")]), table("t")]);
    persist(doc);
    const { blocks } = await outlineDoc("doc:p1:body");
    expect(blocks.map((b) => [b.id, b.depth, b.parentId, b.childCount])).toEqual([
      ["a", 0, null, 1],
      ["c", 1, "a", 0],
      ["t", 0, null, 0],
    ]);
    expect(blocks[0]!.preview.length).toBeLessThanOrEqual(80);
    expect(blocks[0]!.preview.startsWith("word word")).toBe(true);
    expect(blocks[1]!.preview).toBe("child");
    expect(blocks[2]!.table).toEqual({ rows: 2, cols: 2 });
    expect(blocks[0]!.hash).toBe(hashOf(doc, "a"));
    expect(blocks[1]).not.toHaveProperty("table");
  });

  it("reads the live doc when the server has it loaded, without changing it", async () => {
    const live = makeDoc([para("a", "commented text")]);
    comment(live, "a", 0, 9);
    const before = Y.encodeStateAsUpdate(live);
    getCollabServer.mockReturnValue({ hocuspocus: { documents: new Map([["doc:p1:body", live]]) } });

    const { blocks } = await outlineDoc("doc:p1:body");

    expect(blocks[0]!.preview).toBe("commented text");
    expect(findUnique).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(live)).toEqual(before);
    expect(delta(live, "a")[0].attributes).toEqual({ [COMMENT]: COMMENT_VALUE });
  });

  it("outlines a missing doc as empty", async () => {
    expect(await outlineDoc("doc:none:body")).toEqual({ blocks: [] });
  });

  it("returns every top-level block with children when no ids are given", async () => {
    persist(makeDoc([para("a", "one", [para("c", "child")]), para("b", "two")]));
    const out = await getDocBlocks("doc:p1:body");
    expect(out.map((o) => o.block.id)).toEqual(["a", "b"]);
    expect(out[0]!.block.children[0]!.id).toBe("c");
    expect(out[0]!.hash).toBe(blockHash(out[0]!.block));
  });

  it("returns the requested blocks in the order asked, nested ones included", async () => {
    persist(makeDoc([para("a", "one", [para("c", "child")]), para("b", "two")]));
    const out = await getDocBlocks("doc:p1:body", ["c", "a"]);
    expect(out.map((o) => o.block.id)).toEqual(["c", "a"]);
  });

  it("names a missing id", async () => {
    persist(makeDoc([para("a", "one")]));
    await expect(getDocBlocks("doc:p1:body", ["a", "zzz"])).rejects.toMatchObject({
      code: "BLOCK_NOT_FOUND",
      blockId: "zzz",
      message: expect.stringContaining("zzz"),
    });
  });
});

describe("insert", () => {
  it("places blocks at every kind of position", () => {
    const doc = makeDoc([para("a", "A", [para("c", "C")]), para("b", "B")]);
    applyOpsToDoc(doc, [
      { op: "insert", position: { after: "a" }, blocks: [para("x1", "after a")] },
      { op: "insert", position: { before: "a" }, blocks: [para("x2", "before a")] },
      { op: "insert", position: { start: true }, blocks: [para("x3", "start")] },
      { op: "insert", position: { end: true }, blocks: [para("x4", "end")] },
      { op: "insert", position: { firstChildOf: "a" }, blocks: [para("x5", "first child")] },
      { op: "insert", position: { lastChildOf: "a" }, blocks: [para("x6", "last child")] },
      { op: "insert", position: { lastChildOf: "b" }, blocks: [para("x7", "new group")] },
    ]);
    const blocks = read(doc);
    expect(blocks.map((b) => b.id)).toEqual(["x3", "x2", "a", "x1", "b", "x4"]);
    expect(find(blocks, "a")!.children.map((b) => b.id)).toEqual(["x5", "c", "x6"]);
    expect(find(blocks, "b")!.children.map((b) => b.id)).toEqual(["x7"]);
  });

  it("keeps given ids, generates missing ones and replaces duplicates", () => {
    const doc = makeDoc([para("a", "A")]);
    const result = applyOpsToDoc(doc, [
      {
        op: "insert",
        position: { end: true },
        blocks: [
          { id: "mine", type: "paragraph", content: "kept" },
          { type: "paragraph", content: "generated" },
          { id: "a", type: "paragraph", content: "duplicate" },
          { id: "mine", type: "paragraph", content: "duplicate in call" },
        ],
      },
    ]);
    const ids = result.results[0]!.blockIds;
    expect(ids[0]).toBe("mine");
    expect(new Set(ids).size).toBe(4);
    expect(ids.slice(1).every((id) => id !== "a" && id !== "mine")).toBe(true);
    expect(read(doc).map((b) => b.id)).toEqual(["a", ...ids]);
    expect(result.touched).toEqual(ids);
    expect(Object.keys(result.hashes).sort()).toEqual([...ids].sort());
    expect(result.hashes.mine).toBe(hashOf(doc, "mine"));
  });

  it("returns a range over the inserted text", () => {
    const doc = makeDoc([para("a", "A")]);
    const { range } = applyOpsToDoc(doc, [
      { op: "insert", position: { end: true }, blocks: [para("n1", "hello"), para("n2", "world")] },
    ]);
    expect(range).not.toBeNull();
    const start = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(range!.start), doc)!;
    const end = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(range!.end), doc)!;
    expect(start.type).toBe(firstText(container(doc, "n1")));
    expect(start.index).toBe(0);
    expect(end.type).toBe(firstText(container(doc, "n2")));
    expect(end.index).toBe(5);
  });

  it("returns no range when nothing with text was written", () => {
    const doc = makeDoc([para("a", "A")]);
    expect(applyOpsToDoc(doc, [{ op: "insert", position: { end: true }, blocks: [para("e", "")] }]).range).toBeNull();
  });

  it("writes into an empty doc", () => {
    const doc = new Y.Doc();
    applyOpsToDoc(doc, [{ op: "insert", position: { end: true }, blocks: [para("n", "first")] }]);
    expect(read(doc).map((b) => [b.id, text(b)])).toEqual([["n", "first"]]);
  });

  it("lets later ops edit blocks inserted earlier in the call without a hash", () => {
    const doc = makeDoc([para("a", "A")]);
    applyOpsToDoc(doc, [
      { op: "insert", position: { end: true }, blocks: [para("n", "draft", [para("nc", "kid")])] },
      { op: "replace_text", blockId: "n", find: "draft", replace: "final" },
      { op: "update", blockId: "nc", block: { content: "child" } },
    ]);
    expect(text(find(read(doc), "n"))).toBe("final");
    expect(text(find(read(doc), "nc"))).toBe("child");
  });

  it("rejects unknown block types and empty inserts", () => {
    const doc = makeDoc([para("a", "A")]);
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "insert", position: { end: true }, blocks: [{ type: "nope" }] }])).code).toBe("INVALID_OP");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "insert", position: { end: true }, blocks: [] }])).code).toBe("INVALID_OP");
  });

  it("rejects malformed and unknown positions", () => {
    const doc = makeDoc([para("a", "A")]);
    const at = (position: unknown) =>
      attempt(() => applyOpsToDoc(doc, [{ op: "insert", position, blocks: [para("n", "x")] } as DocOp]));
    expect(at({}).code).toBe("INVALID_OP");
    expect(at({ after: "a", before: "a" }).code).toBe("INVALID_OP");
    expect(at({ inside: "a" }).code).toBe("INVALID_OP");
    expect(at({ after: "ghost" })).toMatchObject({ code: "BLOCK_NOT_FOUND", blockId: "ghost", opIndex: 0 });
  });
});

describe("update", () => {
  it("replaces the content and keeps the id and children", () => {
    const doc = makeDoc([para("a", "old", [para("c", "child")])]);
    const result = applyOpsToDoc(doc, [
      { op: "update", blockId: "a", expectedHash: hashOf(doc, "a"), block: { type: "heading", props: { level: 2 }, content: "new" } },
    ]);
    const a = find(read(doc), "a")!;
    expect(a.type).toBe("heading");
    expect(a.props.level).toBe(2);
    expect(text(a)).toBe("new");
    expect(a.children.map((c) => c.id)).toEqual(["c"]);
    expect(result).toMatchObject({ touched: ["a"], results: [{ op: "update", blockIds: ["a"] }] });
    expect(result.hashes.a).toBe(hashOf(doc, "a"));
    expect(result.range).not.toBeNull();
  });

  it("changes only props on the live node when content is omitted, keeping comments", () => {
    const doc = makeDoc([{ id: "t", type: "checkListItem", props: { ...BASE, checked: false }, content: "ship it", children: [] }]);
    comment(doc, "t", 0, 4);
    applyOpsToDoc(doc, [{ op: "update", blockId: "t", expectedHash: hashOf(doc, "t"), block: { props: { checked: true } } }]);
    expect(find(read(doc), "t")!.props.checked).toBe(true);
    expect(delta(doc, "t")).toEqual([{ insert: "ship", attributes: { [COMMENT]: COMMENT_VALUE } }, { insert: " it" }]);
  });

  it("keeps comments when switching between inline block types without new content", () => {
    const doc = makeDoc([para("a", "keep me")]);
    comment(doc, "a", 0, 4);
    applyOpsToDoc(doc, [{ op: "update", blockId: "a", expectedHash: hashOf(doc, "a"), block: { type: "heading", props: { level: 3 } } }]);
    expect(find(read(doc), "a")!.type).toBe("heading");
    expect(delta(doc, "a")[0]).toEqual({ insert: "keep", attributes: { [COMMENT]: COMMENT_VALUE } });
  });

  it("replaces children when given, freeing their old ids", () => {
    const doc = makeDoc([para("a", "A", [para("c", "old child")])]);
    applyOpsToDoc(doc, [
      { op: "update", blockId: "a", expectedHash: hashOf(doc, "a"), block: {}, children: [para("c", "new child"), para("d", "two")] },
    ]);
    expect(find(read(doc), "a")!.children.map((c) => [c.id, text(c)])).toEqual([
      ["c", "new child"],
      ["d", "two"],
    ]);
    applyOpsToDoc(doc, [{ op: "update", blockId: "a", expectedHash: hashOf(doc, "a"), block: {}, children: [] }]);
    expect(find(read(doc), "a")!.children).toEqual([]);
  });

  it("rejects turning a block into a column", () => {
    const doc = makeDoc([para("a", "A")]);
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "update", blockId: "a", expectedHash: hashOf(doc, "a"), block: { type: "column" } }])).code).toBe("INVALID_OP");
  });
});

describe("delete", () => {
  it("removes the block and its children, and drops an emptied child group", () => {
    const doc = makeDoc([para("a", "A", [para("c", "C", [para("g", "G")])]), para("b", "B")]);
    const result = applyOpsToDoc(doc, [{ op: "delete", blockId: "c", expectedHash: hashOf(doc, "c") }]);
    const blocks = read(doc);
    expect(find(blocks, "c")).toBeUndefined();
    expect(find(blocks, "g")).toBeUndefined();
    expect(find(blocks, "a")!.children).toEqual([]);
    expect((container(doc, "a").toArray() as Y.XmlElement[]).map((n) => n.nodeName)).toEqual(["paragraph"]);
    expect(result).toEqual({ touched: [], hashes: {}, range: null, results: [{ op: "delete", blockIds: ["c"] }] });
  });

  it("leaves one empty paragraph when every block is deleted", () => {
    const doc = makeDoc([para("a", "A")]);
    applyOpsToDoc(doc, [{ op: "delete", blockId: "a", expectedHash: hashOf(doc, "a") }]);
    const blocks = read(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "paragraph", content: [] });
  });
});

describe("move", () => {
  it("moves a block with its children and comments", () => {
    const doc = makeDoc([para("a", "A", [para("c", "C")]), para("b", "B")]);
    comment(doc, "a", 0, 1);
    const result = applyOpsToDoc(doc, [{ op: "move", blockId: "a", expectedHash: hashOf(doc, "a"), position: { after: "b" } }]);
    const blocks = read(doc);
    expect(blocks.map((b) => b.id)).toEqual(["b", "a"]);
    expect(find(blocks, "a")!.children.map((c) => c.id)).toEqual(["c"]);
    expect(delta(doc, "a")[0]).toEqual({ insert: "A", attributes: { [COMMENT]: COMMENT_VALUE } });
    expect(result.touched).toEqual([]);
    expect(result.hashes).toEqual({ a: hashOf(doc, "a") });
    expect(result.results).toEqual([{ op: "move", blockIds: ["a"] }]);
  });

  it("moves into another block and out of its old parent", () => {
    const doc = makeDoc([para("a", "A", [para("c", "C")]), para("b", "B")]);
    applyOpsToDoc(doc, [{ op: "move", blockId: "c", expectedHash: hashOf(doc, "c"), position: { firstChildOf: "b" } }]);
    const blocks = read(doc);
    expect(find(blocks, "a")!.children).toEqual([]);
    expect(find(blocks, "b")!.children.map((c) => c.id)).toEqual(["c"]);
  });

  it("refuses to move a block next to or into itself", () => {
    const doc = makeDoc([para("a", "A", [para("c", "C")]), para("b", "B")]);
    const h = hashOf(doc, "a");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "move", blockId: "a", expectedHash: h, position: { after: "a" } }])).code).toBe("INVALID_OP");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "move", blockId: "a", expectedHash: h, position: { firstChildOf: "c" } }])).code).toBe("INVALID_OP");
  });
});

describe("replace_text", () => {
  function richDoc() {
    const doc = makeDoc([
      {
        id: "r",
        type: "paragraph",
        props: BASE,
        content: [
          { type: "text", text: "Ship the ", styles: {} },
          { type: "text", text: "beta build", styles: { bold: true } },
          { type: "text", text: " on Friday", styles: {} },
        ],
        children: [],
      },
    ]);
    return doc;
  }

  it("replaces the match in place, keeping its formatting and comments around it", () => {
    const doc = richDoc();
    comment(doc, "r", 0, 4);
    comment(doc, "r", 9, 4);
    const result = applyOpsToDoc(doc, [{ op: "replace_text", blockId: "r", expectedHash: hashOf(doc, "r"), find: "beta", replace: "final" }]);
    expect(delta(doc, "r")).toEqual([
      { insert: "Ship", attributes: { [COMMENT]: COMMENT_VALUE } },
      { insert: " the " },
      { insert: "final", attributes: { bold: {}, [COMMENT]: COMMENT_VALUE } },
      { insert: " build", attributes: { bold: {} } },
      { insert: " on Friday" },
    ]);
    expect(result.touched).toEqual(["r"]);
    expect(result.hashes.r).toBe(hashOf(doc, "r"));
    const t = firstText(container(doc, "r"));
    const start = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(result.range!.start), doc)!;
    const end = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(result.range!.end), doc)!;
    expect([start.type, start.index, end.type, end.index]).toEqual([t, 9, t, 14]);
  });

  it("deletes the match when replace is empty", () => {
    const doc = richDoc();
    applyOpsToDoc(doc, [{ op: "replace_text", blockId: "r", expectedHash: hashOf(doc, "r"), find: " on Friday", replace: "" }]);
    expect(text(find(read(doc), "r"))).toBe("Ship the beta build");
  });

  it("reports missing, repeated and inline-spanning matches", () => {
    const doc = makeDoc([
      {
        id: "m",
        type: "paragraph",
        props: BASE,
        content: [
          { type: "text", text: "ask a and a ", styles: {} },
          { type: "mention", props: { id: "u1", label: "Kiran" } },
          { type: "text", text: " then\nwait", styles: {} },
        ],
        children: [],
      },
    ]);
    const h = hashOf(doc, "m");
    const run = (find: string) =>
      attempt(() => applyOpsToDoc(doc, [{ op: "replace_text", blockId: "m", expectedHash: h, find, replace: "x" }]));
    expect(run("zebra")).toMatchObject({ code: "TEXT_NOT_FOUND", blockId: "m", opIndex: 0 });
    expect(run("a")).toMatchObject({ code: "TEXT_AMBIGUOUS" });
    expect(run("and a @Kiran")).toMatchObject({ code: "TEXT_SPANS_INLINE" });
    expect(run("a  then")).toMatchObject({ code: "TEXT_SPANS_INLINE" });
    expect(run("then\nwait")).toMatchObject({ code: "TEXT_SPANS_INLINE" });
  });

  it("rejects a line break in the replacement and an empty find", () => {
    const doc = richDoc();
    const h = hashOf(doc, "r");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "replace_text", blockId: "r", expectedHash: h, find: "beta", replace: "a\nb" }])).code).toBe("INVALID_OP");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "replace_text", blockId: "r", expectedHash: h, find: "", replace: "b" }])).code).toBe("INVALID_OP");
  });

  it("does not look inside table cells", () => {
    const doc = makeDoc([table("t")]);
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "replace_text", blockId: "t", expectedHash: hashOf(doc, "t"), find: "Launch", replace: "x" }])).code).toBe("TEXT_NOT_FOUND");
  });
});

describe("table ops", () => {
  const rows = (doc: Y.Doc) =>
    (find(read(doc), "t")!.content as { rows: { cells: { content: never[] }[] }[] }).rows.map((r) =>
      r.cells.map((c) => text({ content: c.content } as unknown as DocBlock)),
    );
  const mentionSurvives = (doc: Y.Doc) => {
    const cells = (find(read(doc), "t")!.content as { rows: { cells: { content: DocBlock["content"] }[] }[] }).rows;
    return cells.flatMap((r) => r.cells.flatMap((c) => c.content as Array<{ type: string; props?: unknown }>)).find((i) => i.type === "mention");
  };

  it("appends a row by default and keeps mentions in other cells", () => {
    const doc = makeDoc([table("t")]);
    const result = applyOpsToDoc(doc, [
      { op: "insert_row", blockId: "t", expectedHash: hashOf(doc, "t"), cells: [[{ type: "text", text: "Docs", styles: {} }], []] },
    ]);
    expect(rows(doc)).toEqual([["Name", "Owner"], ["Launch", "@Kiran"], ["Docs", ""]]);
    expect(mentionSurvives(doc)).toEqual({ type: "mention", props: { id: "u1", label: "Kiran" } });
    expect(result).toMatchObject({ touched: ["t"], results: [{ op: "insert_row", blockIds: ["t"] }] });
    expect(result.hashes.t).toBe(hashOf(doc, "t"));
    expect(result.range).not.toBeNull();
  });

  it("inserts a header row inside the header band", () => {
    const doc = makeDoc([table("t")]);
    applyOpsToDoc(doc, [
      { op: "insert_row", blockId: "t", expectedHash: hashOf(doc, "t"), index: 0, cells: [[{ type: "text", text: "Top", styles: {} }], []] },
    ]);
    const tableEl = container(doc, "t").get(0) as Y.XmlElement;
    const firstRow = tableEl.get(0) as Y.XmlElement;
    expect((firstRow.toArray() as Y.XmlElement[]).map((c) => c.nodeName)).toEqual(["tableHeader", "tableHeader"]);
    expect(rows(doc)[0]).toEqual(["Top", ""]);
  });

  it("checks the row index and the column count", () => {
    const doc = makeDoc([table("t")]);
    const h = hashOf(doc, "t");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "insert_row", blockId: "t", expectedHash: h, index: 5, cells: [[], []] }])).code).toBe("ROW_OUT_OF_RANGE");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "insert_row", blockId: "t", expectedHash: h, cells: [[]] }])).code).toBe("INVALID_OP");
  });

  it("deletes a row", () => {
    const doc = makeDoc([table("t")]);
    const result = applyOpsToDoc(doc, [{ op: "delete_row", blockId: "t", expectedHash: hashOf(doc, "t"), index: 0 }]);
    expect(rows(doc)).toEqual([["Launch", "@Kiran"]]);
    expect(result.touched).toEqual(["t"]);
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "delete_row", blockId: "t", expectedHash: hashOf(doc, "t"), index: 0 }])).code).toBe("INVALID_OP");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "delete_row", blockId: "t", expectedHash: hashOf(doc, "t"), index: 3 }])).code).toBe("ROW_OUT_OF_RANGE");
  });

  it("sets one cell and leaves mentions and comments in the others alone", () => {
    const doc = makeDoc([table("t")]);
    const nameCell = firstText(((container(doc, "t").get(0) as Y.XmlElement).get(1) as Y.XmlElement).get(0) as Y.XmlElement);
    nameCell.format(0, 3, { [COMMENT]: COMMENT_VALUE });
    const result = applyOpsToDoc(doc, [
      { op: "set_cell", blockId: "t", expectedHash: hashOf(doc, "t"), row: 0, col: 1, content: [{ type: "text", text: "Lead", styles: { italic: true } }] },
    ]);
    expect(rows(doc)).toEqual([["Name", "Lead"], ["Launch", "@Kiran"]]);
    expect(mentionSurvives(doc)).toBeDefined();
    expect(nameCell.toDelta()[0]).toEqual({ insert: "Lau", attributes: { [COMMENT]: COMMENT_VALUE } });
    expect(result.range).not.toBeNull();
  });

  it("checks cell coordinates and that the block is a table", () => {
    const doc = makeDoc([table("t"), para("p", "P")]);
    const h = hashOf(doc, "t");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "set_cell", blockId: "t", expectedHash: h, row: 9, col: 0, content: [] }])).code).toBe("ROW_OUT_OF_RANGE");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "set_cell", blockId: "t", expectedHash: h, row: 0, col: 2, content: [] }])).code).toBe("CELL_OUT_OF_RANGE");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "set_cell", blockId: "p", expectedHash: hashOf(doc, "p"), row: 0, col: 0, content: [] }])).code).toBe("NOT_A_TABLE");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "delete_row", blockId: "p", expectedHash: hashOf(doc, "p"), index: 0 }])).code).toBe("NOT_A_TABLE");
  });
});

describe("replace_all", () => {
  it("replaces the whole body", () => {
    const doc = makeDoc([para("a", "A"), para("b", "B")]);
    const result = applyOpsToDoc(doc, [{ op: "replace_all", blocks: [para("n", "new body")] }]);
    expect(read(doc).map((b) => [b.id, text(b)])).toEqual([["n", "new body"]]);
    expect(result.touched).toEqual(["n"]);
    expect(result.range).not.toBeNull();
  });

  it("must be the only op", () => {
    const doc = makeDoc([para("a", "A")]);
    expect(
      attempt(() =>
        applyOpsToDoc(doc, [
          { op: "insert", position: { end: true }, blocks: [para("n", "x")] },
          { op: "replace_all", blocks: [] },
        ]),
      ),
    ).toMatchObject({ code: "INVALID_OP", opIndex: 1 });
  });
});

describe("hash checks", () => {
  it("rejects a stale hash and returns the current block", () => {
    const doc = makeDoc([para("a", "A"), para("b", "current text")]);
    const err = attempt(() =>
      applyOpsToDoc(doc, [
        { op: "replace_text", blockId: "a", expectedHash: hashOf(doc, "a"), find: "A", replace: "Z" },
        { op: "delete", blockId: "b", expectedHash: "000000000000" },
      ]),
    );
    expect(err).toBeInstanceOf(DocEditError);
    expect(err).toMatchObject({ code: "BLOCK_CHANGED", opIndex: 1, blockId: "b" });
    expect(text(err.current!.block)).toBe("current text");
    expect(err.current!.hash).toBe(hashOf(doc, "b"));
  });

  it("requires a hash for blocks the call has not touched yet", () => {
    const doc = makeDoc([para("a", "A")]);
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "delete", blockId: "a" }]))).toMatchObject({ code: "INVALID_OP", blockId: "a" });
  });

  it("accepts the original hash for a block an earlier op already changed", () => {
    const doc = makeDoc([para("a", "one two")]);
    const h = hashOf(doc, "a");
    applyOpsToDoc(doc, [
      { op: "replace_text", blockId: "a", expectedHash: h, find: "one", replace: "1" },
      { op: "replace_text", blockId: "a", expectedHash: h, find: "two", replace: "2" },
    ]);
    expect(text(find(read(doc), "a"))).toBe("1 2");
  });

  it("still checks children of a block whose own content an earlier op updated", () => {
    const doc = makeDoc([para("a", "A", [para("c", "child")])]);
    const err = attempt(() =>
      applyOpsToDoc(doc, [
        { op: "update", blockId: "a", expectedHash: hashOf(doc, "a"), block: { content: "x" } },
        { op: "replace_text", blockId: "c", expectedHash: "stale", find: "child", replace: "kid" },
      ]),
    );
    expect(err).toMatchObject({ code: "BLOCK_CHANGED", opIndex: 1, blockId: "c" });
  });

  it("still checks a block after an earlier op moved it", () => {
    const doc = makeDoc([para("a", "A"), para("b", "B")]);
    const err = attempt(() =>
      applyOpsToDoc(doc, [
        { op: "move", blockId: "a", expectedHash: hashOf(doc, "a"), position: { end: true } },
        { op: "delete", blockId: "a", expectedHash: "stale" },
      ]),
    );
    expect(err).toMatchObject({ code: "BLOCK_CHANGED", opIndex: 1 });
  });

  it("returns the same hash the outline reads for numbered list items", () => {
    const item = (id: string, t: string): DocBlock => ({ id, type: "numberedListItem", props: BASE, content: t, children: [] });
    const doc = makeDoc([item("n1", "one"), item("n2", "two"), item("n3", "three")]);
    const result = applyOpsToDoc(doc, [
      { op: "replace_text", blockId: "n2", expectedHash: hashOf(doc, "n2"), find: "two", replace: "2" },
    ]);
    expect(result.hashes.n2).toBe(hashOf(doc, "n2"));
    expect(
      applyOpsToDoc(doc, [{ op: "replace_text", blockId: "n3", expectedHash: hashOf(doc, "n3"), find: "three", replace: "3" }]).hashes.n3,
    ).toBe(hashOf(doc, "n3"));
  });
});

describe("atomicity and safety", () => {
  it("leaves the doc byte-identical when the third op fails", () => {
    const doc = makeDoc([para("a", "A"), para("b", "B"), table("t")]);
    const before = Y.encodeStateAsUpdate(doc);
    const err = attempt(() =>
      applyOpsToDoc(doc, [
        { op: "insert", position: { end: true }, blocks: [para("n", "new")] },
        { op: "replace_text", blockId: "a", expectedHash: hashOf(doc, "a"), find: "A", replace: "Z" },
        { op: "set_cell", blockId: "t", expectedHash: hashOf(doc, "t"), row: 0, col: 7, content: [] },
      ]),
    );
    expect(err).toMatchObject({ code: "CELL_OUT_OF_RANGE", opIndex: 2 });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it("keeps comment formats on blocks it does not touch", () => {
    const doc = makeDoc([para("keep", "untouched note"), para("a", "A", [para("c", "C")]), table("t")]);
    comment(doc, "keep", 0, 9);
    applyOpsToDoc(doc, [
      { op: "insert", position: { after: "keep" }, blocks: [para("n", "new")] },
      { op: "update", blockId: "a", expectedHash: hashOf(doc, "a"), block: { content: "changed" } },
      { op: "move", blockId: "c", expectedHash: hashOf(doc, "c"), position: { start: true } },
      { op: "set_cell", blockId: "t", expectedHash: hashOf(doc, "t"), row: 1, col: 0, content: [] },
      { op: "insert_row", blockId: "t", cells: [[], []] },
    ]);
    expect(delta(doc, "keep")).toEqual([{ insert: "untouched", attributes: { [COMMENT]: COMMENT_VALUE } }, { insert: " note" }]);
  });

  it("refuses legacy documents", () => {
    const doc = new Y.Doc();
    const legacy = doc.getXmlFragment("default");
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText("old")]);
    legacy.insert(0, [p]);
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "insert", position: { end: true }, blocks: [para("n", "x")] }])).code).toBe("LEGACY_DOC");
  });

  it("rejects unknown ops and empty op lists", () => {
    const doc = makeDoc([para("a", "A")]);
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "explode" } as unknown as DocOp]))).toMatchObject({ code: "INVALID_OP", opIndex: 0 });
    expect(attempt(() => applyOpsToDoc(doc, []))).toMatchObject({ code: "INVALID_OP", opIndex: null });
  });
});

describe("column blocks", () => {
  const columns = (): DocBlock[] => [
    {
      id: "cl",
      type: "columnList",
      props: {},
      content: undefined,
      children: [
        { id: "col1", type: "column", props: { width: 1 }, children: [para("l", "left")] },
        { id: "col2", type: "column", props: { width: 1 }, children: [para("r", "right")] },
      ],
    },
    para("p", "P"),
  ];

  it("edits blocks inside a column", () => {
    const doc = makeDoc(columns());
    applyOpsToDoc(doc, [
      { op: "insert", position: { lastChildOf: "col1" }, blocks: [para("l2", "left two")] },
      { op: "replace_text", blockId: "r", expectedHash: hashOf(doc, "r"), find: "right", replace: "RIGHT" },
    ]);
    const blocks = read(doc);
    expect(find(blocks, "col1")!.children.map((b) => b.id)).toEqual(["l", "l2"]);
    expect(text(find(blocks, "r"))).toBe("RIGHT");
  });

  it("refills a column whose last block is deleted", () => {
    const doc = makeDoc(columns());
    applyOpsToDoc(doc, [{ op: "delete", blockId: "l", expectedHash: hashOf(doc, "l") }]);
    const col = find(read(doc), "col1")!;
    expect(col.children).toHaveLength(1);
    expect(col.children[0]).toMatchObject({ type: "paragraph", content: [] });
  });

  it("refuses column-level structure changes", () => {
    const doc = makeDoc(columns());
    const ins = (position: unknown) =>
      attempt(() => applyOpsToDoc(doc, [{ op: "insert", position, blocks: [para("n", "x")] } as DocOp])).code;
    expect(ins({ after: "col1" })).toBe("INVALID_OP");
    expect(ins({ firstChildOf: "cl" })).toBe("INVALID_OP");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "delete", blockId: "col1", expectedHash: "x" }])).code).toBe("INVALID_OP");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "update", blockId: "cl", expectedHash: "x", block: {} }])).code).toBe("INVALID_OP");
    expect(attempt(() => applyOpsToDoc(doc, [{ op: "insert", position: { firstChildOf: "p" }, blocks: columns().slice(0, 1) }])).code).toBe("INVALID_OP");
  });

  it("moves a whole column list", () => {
    const doc = makeDoc(columns());
    applyOpsToDoc(doc, [{ op: "move", blockId: "cl", expectedHash: hashOf(doc, "cl"), position: { end: true } }]);
    const blocks = read(doc);
    expect(blocks.map((b) => b.id)).toEqual(["p", "cl"]);
    expect(find(blocks, "col2")!.children.map((b) => b.id)).toEqual(["r"]);
  });
});

describe("applyDocOps", () => {
  it("edits the persisted state when no collab server runs, then stores and snapshots it", async () => {
    findUnique.mockResolvedValue({ state: Y.encodeStateAsUpdate(makeDoc([para("a", "A")])) });
    let saved: DocBlock[] = [];
    storeDocument.mockImplementation(async (_name: string, doc: Y.Doc) => {
      saved = read(doc);
      return { state: new Uint8Array([1]), plainText: "" };
    });

    const result = await applyDocOps("doc:p1:body", [{ op: "insert", position: { end: true }, blocks: [para("n", "new")] }], "u-ada");

    expect(saved.map((b) => b.id)).toEqual(["a", "n"]);
    expect(storeDocument).toHaveBeenCalledWith("doc:p1:body", expect.any(Y.Doc));
    expect(maybeSnapshot).toHaveBeenCalledWith("doc:p1:body", { state: new Uint8Array([1]), plainText: "" }, ["u-ada"]);
    expect(result.touched).toEqual(["n"]);
  });

  it("stores nothing when an op fails", async () => {
    findUnique.mockResolvedValue({ state: Y.encodeStateAsUpdate(makeDoc([para("a", "A")])) });
    await expect(
      applyDocOps("doc:p1:body", [{ op: "delete", blockId: "ghost", expectedHash: "x" }], "u-ada"),
    ).rejects.toMatchObject({ code: "BLOCK_NOT_FOUND" });
    expect(storeDocument).not.toHaveBeenCalled();
  });

  function liveServer(doc: Y.Doc) {
    const conn = {
      transact: vi.fn(async (fn: (d: Y.Doc) => void) => fn(doc)),
      disconnect: vi.fn(async () => {}),
    };
    const openDirectConnection = vi.fn(async () => conn);
    getCollabServer.mockReturnValue({ hocuspocus: { openDirectConnection, documents: new Map() } });
    return { conn, openDirectConnection };
  }

  it("writes through the live connection and reports the result once applied", async () => {
    const live = makeDoc([para("a", "A")]);
    const { conn, openDirectConnection } = liveServer(live);
    const onApplied = vi.fn();

    const result = await applyDocOps(
      "doc:p1:body",
      [{ op: "replace_text", blockId: "a", expectedHash: hashOf(live, "a"), find: "A", replace: "B" }],
      "u-ada",
      { onApplied },
    );

    expect(openDirectConnection).toHaveBeenCalledWith("doc:p1:body");
    expect(text(find(read(live), "a"))).toBe("B");
    expect(onApplied).toHaveBeenCalledWith(result);
    expect(conn.disconnect).toHaveBeenCalled();
    expect(storeDocument).not.toHaveBeenCalled();
  });

  it("leaves the live doc alone and skips the callback when an op fails", async () => {
    const live = makeDoc([para("a", "A")]);
    const { conn } = liveServer(live);
    const before = Y.encodeStateAsUpdate(live);
    const onApplied = vi.fn();

    await expect(
      applyDocOps(
        "doc:p1:body",
        [
          { op: "insert", position: { end: true }, blocks: [para("n", "x")] },
          { op: "delete", blockId: "a", expectedHash: "stale" },
        ],
        "u-ada",
        { onApplied },
      ),
    ).rejects.toMatchObject({ code: "BLOCK_CHANGED", opIndex: 1 });

    expect(Y.encodeStateAsUpdate(live)).toEqual(before);
    expect(onApplied).not.toHaveBeenCalled();
    expect(conn.disconnect).toHaveBeenCalled();
  });
});
