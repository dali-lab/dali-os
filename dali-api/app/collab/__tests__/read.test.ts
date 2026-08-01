import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";

vi.mock("~/lib/db", () => {
  const mock: any = {
    collabDocument: { findUnique: vi.fn() },
  };
  return { prisma: mock };
});

import { prisma } from "~/lib/db";
import { readDocAsBlocks, stateToBlocks, ydocToBlocks } from "../read";
import { blocksToFragment, plainTextToBlocks } from "../blocknote-server";
import { blocksToPlainText } from "~/components/doc/schema/configs";

const mockPrisma = prisma as any;

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
