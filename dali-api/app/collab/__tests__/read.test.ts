import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";

vi.mock("~/lib/db.server", () => {
  const mock: any = {
    collabDocument: { findUnique: vi.fn() },
  };
  return { prisma: mock };
});

import { prisma } from "~/lib/db.server";
import { readDocAsBlocks, stateToBlocks, ydocToBlocks } from "../read";
import { BLOCKNOTE_FRAGMENT, blocksToFragment, plainTextToBlocks } from "../blocknote-server";
import { collabDocToProseMirror } from "../export";
import { blocksToPlainText } from "~/components/doc/schema/configs";

const mockPrisma = prisma as any;


function docWithCommentMark(text = "hello"): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => blocksToFragment(plainTextToBlocks(text), doc.getXmlFragment(BLOCKNOTE_FRAGMENT)));
  doc.transact(() => {
    const t = findXmlText(doc.getXmlFragment(BLOCKNOTE_FRAGMENT))[0];
    t.format(0, text.length, { "comment--abc": { id: "abc" } } as any);
  });
  return doc;
}

function docWithUnknownNode(text = "hello"): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(BLOCKNOTE_FRAGMENT);
  doc.transact(() => blocksToFragment(plainTextToBlocks(text), fragment));
  doc.transact(() => {
    const container = (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlElement;
    const ghost = new Y.XmlElement("notInServerSchema");
    const ghostText = new Y.XmlText();
    ghostText.insert(0, "ghost");
    ghost.insert(0, [ghostText]);
    container.push([ghost]);
  });
  return doc;
}

function findXmlText(el: Y.XmlFragment | Y.XmlElement, out: Y.XmlText[] = []): Y.XmlText[] {
  for (let i = 0; i < el.length; i++) {
    const c = el.get(i);
    if (c instanceof Y.XmlText) out.push(c);
    else if (c instanceof Y.XmlElement) findXmlText(c, out);
  }
  return out;
}

const stateOf = (doc: Y.Doc) => Buffer.from(Y.encodeStateAsUpdate(doc));

beforeEach(() => vi.clearAllMocks());

function legacyDocState(text: string): Buffer {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  doc.transact(() => {
    const p = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, text);
    p.insert(0, [t]);
    fragment.push([p]);
  });
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

function blocknoteDocState(text: string): Buffer {
  const doc = new Y.Doc();
  doc.transact(() => {
    blocksToFragment(plainTextToBlocks(text), doc.getXmlFragment("blocknote"));
  });
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

describe("ydocToBlocks", () => {
  it("prefers the blocknote fragment when present", () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      blocksToFragment(plainTextToBlocks("new world"), doc.getXmlFragment("blocknote"));
    });
    // Stale legacy content alongside — must be ignored.
    const legacy = doc.getXmlFragment("default");
    doc.transact(() => {
      const p = new Y.XmlElement("paragraph");
      const t = new Y.XmlText();
      t.insert(0, "old world");
      p.insert(0, [t]);
      legacy.push([p]);
    });

    const { blocks, source } = ydocToBlocks(doc);
    expect(source).toBe("blocknote");
    expect(blocksToPlainText(blocks)).toBe("new world");
  });

  it("maps legacy default-fragment content in memory", () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(legacyDocState("legacy text")));
    const { blocks, source } = ydocToBlocks(doc);
    expect(source).toBe("legacy");
    expect(blocksToPlainText(blocks)).toBe("legacy text");
    // Read is non-mutating: the blocknote fragment stays empty.
    expect(doc.getXmlFragment("blocknote").length).toBe(0);
  });

  it("reports empty docs", () => {
    const { blocks, source } = ydocToBlocks(new Y.Doc());
    expect(source).toBe("empty");
    expect(blocks).toEqual([]);
  });
});

describe("stateToBlocks", () => {
  it("swallows undecodable state", () => {
    const { blocks, source } = stateToBlocks(new Uint8Array([1, 2, 3, 4]));
    expect(source).toBe("empty");
    expect(blocks).toEqual([]);
  });
});

describe("readDocAsBlocks", () => {
  it("returns [] when no CollabDocument row exists", async () => {
    mockPrisma.collabDocument.findUnique.mockResolvedValue(null);
    expect(await readDocAsBlocks("doc:x:body")).toEqual([]);
  });

  it("reads converted (blocknote) documents", async () => {
    mockPrisma.collabDocument.findUnique.mockResolvedValue({
      state: blocknoteDocState("converted body"),
    });
    const blocks = await readDocAsBlocks("doc:x:body");
    expect(blocksToPlainText(blocks)).toBe("converted body");
  });

  it("reads unconverted legacy documents through the mapper", async () => {
    mockPrisma.collabDocument.findUnique.mockResolvedValue({
      state: legacyDocState("still tiptap"),
    });
    const blocks = await readDocAsBlocks("doc:x:body");
    expect(blocksToPlainText(blocks)).toBe("still tiptap");
  });
});

describe("ydocToBlocks on a live doc", () => {
  it("returns the known blocks and leaves a doc with an unknown node untouched", () => {
    const doc = docWithUnknownNode("hello");
    const before = stateOf(doc);
    const updates: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(u));

    const { blocks } = ydocToBlocks(doc);

    expect(blocksToPlainText(blocks)).toContain("hello");
    expect(updates).toEqual([]);
    expect(stateOf(doc).equals(before)).toBe(true);
  });

  it("keeps text under a comment mark and leaves the live doc untouched", () => {
    const doc = docWithCommentMark("hello");
    const before = stateOf(doc);
    expect(blocksToPlainText(ydocToBlocks(doc).blocks)).toBe("hello");
    expect(stateOf(doc).equals(before)).toBe(true);
  });
});

describe("throwaway decodes keep commented text", () => {
  it("stateToBlocks reads text under a comment mark", () => {
    expect(blocksToPlainText(stateToBlocks(stateOf(docWithCommentMark("hello"))).blocks)).toBe("hello");
  });

  it("collabDocToProseMirror keeps text under a comment mark", async () => {
    mockPrisma.collabDocument.findUnique.mockResolvedValue({ state: stateOf(docWithCommentMark("hello")) });
    expect(JSON.stringify(await collabDocToProseMirror("doc:p1:body"))).toContain("hello");
  });
});
