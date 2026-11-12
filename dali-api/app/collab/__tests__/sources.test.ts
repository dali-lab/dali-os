import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";

// Mock the DB + roles before importing the module under test.
vi.mock("~/lib/db.server", () => {
  const mock: any = {
    mentorNote: { findUnique: vi.fn(), updateMany: vi.fn() },
    blogPost: { findUnique: vi.fn(), updateMany: vi.fn() },
    mentorNoteTemplate: { findUnique: vi.fn(), update: vi.fn() },
  };
  return { prisma: mock };
});
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { COLLAB_SOURCES, isStructuredRoom, seedRegistryDoc, syncRegistryDocBack } from "../sources";
import { BLOCKNOTE_FRAGMENT, blocksToFragment, plainTextToBlocks } from "../blocknote-server";
import { ydocToBlocks } from "../read";

vi.mock("../read", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../read")>();
  return { ...actual, ydocToBlocks: vi.fn(actual.ydocToBlocks) };
});
import { blocksToPlainText } from "~/components/doc/schema/configs";

const mockPrisma = prisma as any;
const mockIsCore = isCore as any;

// Legacy PM column value — seeds must survive the migration boundary.
const HELLO_PM_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
};


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

describe("seedRegistryDoc", () => {
  it("seeds a new room's blocknote fragment from a legacy ProseMirror column", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue({ contentJson: HELLO_PM_DOC });
    const doc = new Y.Doc();
    const handled = await seedRegistryDoc("mentorNote", "n1", doc);
    expect(handled).toBe(true);
    const { blocks, source } = ydocToBlocks(doc);
    expect(source).toBe("blocknote");
    expect(blocksToPlainText(blocks)).toBe("Hello");
  });

  it("seeds from an already-converted block JSON column", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue({
      contentJson: plainTextToBlocks("Block hello"),
    });
    const doc = new Y.Doc();
    const handled = await seedRegistryDoc("mentorNote", "n1", doc);
    expect(handled).toBe(true);
    expect(blocksToPlainText(ydocToBlocks(doc).blocks)).toBe("Block hello");
  });

  it("claims the entity but seeds nothing for the empty-object default", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue({ contentJson: {} });
    const doc = new Y.Doc();
    const handled = await seedRegistryDoc("mentorNote", "n1", doc);
    expect(handled).toBe(true);
    expect(doc.getXmlFragment(BLOCKNOTE_FRAGMENT).length).toBe(0);
  });

  it("seeds nothing for a note that has moved to a page", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue({ contentJson: HELLO_PM_DOC, pageId: "p1" });
    const doc = new Y.Doc();
    expect(await seedRegistryDoc("mentorNote", "n1", doc)).toBe(true);
    expect(doc.getXmlFragment(BLOCKNOTE_FRAGMENT).length).toBe(0);
  });

  it("returns false for a non-registry entity (legacy plain-text path)", async () => {
    const doc = new Y.Doc();
    expect(await seedRegistryDoc("review", "r1", doc)).toBe(false);
  });
});

describe("syncRegistryDocBack", () => {
  it("writes the live doc back to the source column as block JSON", async () => {
    const doc = new Y.Doc();
    mockPrisma.mentorNote.findUnique.mockResolvedValue({ contentJson: HELLO_PM_DOC });
    await seedRegistryDoc("mentorNote", "n1", doc);

    const handled = await syncRegistryDocBack("mentorNote", "n1", doc);
    expect(handled).toBe(true);
    expect(mockPrisma.mentorNote.updateMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.mentorNote.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "n1", pageId: null });
    // Sync-back stores BLOCK JSON (an array), not a PM doc.
    expect(Array.isArray(arg.data.contentJson)).toBe(true);
    expect(blocksToPlainText(arg.data.contentJson)).toBe("Hello");
  });

  it("returns false for a non-registry entity", async () => {
    const doc = new Y.Doc();
    expect(await syncRegistryDocBack("review", "r1", doc)).toBe(false);
  });
});

describe("authorize", () => {
  it("mentorNote: the author may edit", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue({ mentorId: "u1" });
    mockIsCore.mockResolvedValue(false);
    expect(await COLLAB_SOURCES.mentorNote.authorize("u1", "n1")).toBe(true);
  });

  it("mentorNote: a non-author non-Core mentor may not", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue({ mentorId: "u1" });
    mockIsCore.mockResolvedValue(false);
    expect(await COLLAB_SOURCES.mentorNote.authorize("u2", "n1")).toBe(false);
  });

  it("mentorNote: Core may edit any note", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue({ mentorId: "u1" });
    mockIsCore.mockResolvedValue(true);
    expect(await COLLAB_SOURCES.mentorNote.authorize("u2", "n1")).toBe(true);
  });

  it("mentorNote: a note that has moved to a page is closed to everyone, Core included", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue({ mentorId: "u1", pageId: "p1" });
    mockIsCore.mockResolvedValue(true);
    expect(await COLLAB_SOURCES.mentorNote.authorize("u1", "n1")).toBe(false);
    expect(await COLLAB_SOURCES.mentorNote.authorize("u2", "n1")).toBe(false);
  });

  it("mentorNote: a missing note is denied", async () => {
    mockPrisma.mentorNote.findUnique.mockResolvedValue(null);
    mockIsCore.mockResolvedValue(true);
    expect(await COLLAB_SOURCES.mentorNote.authorize("u1", "nope")).toBe(false);
  });

  it("mentorNoteTemplate: Core only", async () => {
    mockIsCore.mockResolvedValue(true);
    expect(await COLLAB_SOURCES.mentorNoteTemplate.authorize("u1", "t1")).toBe(true);
    mockIsCore.mockResolvedValue(false);
    expect(await COLLAB_SOURCES.mentorNoteTemplate.authorize("u1", "t1")).toBe(false);
  });
});

describe("isStructuredRoom", () => {
  it("treats slide decks like whiteboards, which are Y.Map rooms", () => {
    expect(isStructuredRoom("slides")).toBe(true);
    expect(isStructuredRoom("whiteboard")).toBe(true);
    expect(isStructuredRoom("doc")).toBe(false);
  });
});

describe("syncRegistryDocBack leaves the live doc alone", () => {
  const fixtures: Array<[string, () => Y.Doc]> = [
    ["a comment mark", () => docWithCommentMark("hello")],
    ["a node the server schema does not know", () => docWithUnknownNode("hello")],
  ];

  it.each(fixtures)("emits no update and keeps the state bytes with %s", async (_name, make) => {
    const doc = make();
    const before = stateOf(doc);
    const updates: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(u));

    await syncRegistryDocBack("blogPost", "n1", doc);

    expect(updates).toEqual([]);
    expect(stateOf(doc).equals(before)).toBe(true);
  });

  it("writes the commented text into the blog post column", async () => {
    await syncRegistryDocBack("blogPost", "n1", docWithCommentMark("hello"));
    const data = mockPrisma.blogPost.updateMany.mock.calls[0][0].data;
    expect(blocksToPlainText(data.contentJson)).toBe("hello");
  });

  it.each(["form", "rubric", "signing"])("does not decode the %s room and still reports it handled", async (entity) => {
    vi.mocked(ydocToBlocks).mockClear();
    await expect(syncRegistryDocBack(entity, "x1", docWithCommentMark())).resolves.toBe(true);
    expect(ydocToBlocks).not.toHaveBeenCalled();
  });

  it("reports an unregistered entity as not handled", async () => {
    await expect(syncRegistryDocBack("nope", "x1", new Y.Doc())).resolves.toBe(false);
  });
});
