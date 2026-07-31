import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";

// Mock the DB + roles before importing the module under test.
vi.mock("~/lib/db", () => {
  const mock: any = {
    mentorNote: { findUnique: vi.fn(), update: vi.fn() },
    mentorNoteTemplate: { findUnique: vi.fn(), update: vi.fn() },
  };
  return { prisma: mock };
});
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { COLLAB_SOURCES, seedRegistryDoc, syncRegistryDocBack } from "../sources";
import { BLOCKNOTE_FRAGMENT, plainTextToBlocks } from "../blocknote-server";
import { ydocToBlocks } from "../read";
import { blocksToPlainText } from "~/components/doc/schema/configs";

const mockPrisma = prisma as any;
const mockIsCore = isCore as any;

// Legacy PM column value — seeds must survive the migration boundary.
const HELLO_PM_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
};

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
    expect(mockPrisma.mentorNote.update).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.mentorNote.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "n1" });
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
