import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("~/lib/db.server", () => {
  const mock: any = {
    collabDocument: { findUnique: vi.fn(), upsert: vi.fn() },
    collabDocumentVersion: { findUnique: vi.fn(), create: vi.fn() },
  };
  return { prisma: mock };
});
vi.mock("~/lib/doc-search.server", () => ({ indexPageBody: vi.fn() }));
vi.mock("~/collab/server", () => ({ getCollabServer: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { indexPageBody } from "~/lib/doc-search.server";
import { forceSnapshot, loadDocument, restoreVersion, storeDocument } from "../persistence";
import { seedDeckDoc } from "../deck-write.server";
import { projectLegacySlides, readDeck } from "../read-deck.server";
import { isDeleted, restoreEpochOf, slidesMap, tombstoneSlide } from "~/components/slides/deck/model";
import type { Slide } from "~/components/slides/types";

const mockPrisma = prisma as any;
const NAME = "slides:p1:deck";
const SLIDES: Slide[] = [
  { id: "a", layout: "title", title: "Quarterly review", notes: "speaker words" },
  { id: "b", layout: "content", title: "Roadmap" },
];

const deck = () => {
  const doc = new Y.Doc();
  seedDeckDoc(doc, SLIDES);
  return doc;
};

const serverFor = (live: Y.Doc) => ({
  hocuspocus: {
    openDirectConnection: async () => ({
      document: live,
      transact: async (fn: (d: Y.Doc) => void) => live.transact(() => fn(live)),
      disconnect: async () => {},
    }),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.collabDocument.upsert.mockResolvedValue({ updatedAt: new Date("2026-11-05T12:00:00Z") });
});

describe("storeDocument for a slides room", () => {
  it("mirrors the deck's slide and notes text, not an empty blocknote read", async () => {
    const stored = await storeDocument(NAME, deck());
    expect(stored!.plainText).toContain("Quarterly review");
    expect(stored!.plainText).toContain("speaker words");
    expect(stored!.plainText).toContain("Roadmap");
  });

  it("indexes the deck's text for search under the page id", async () => {
    await storeDocument(NAME, deck());
    expect(indexPageBody).toHaveBeenCalledWith("p1", expect.stringContaining("Roadmap"), new Date("2026-11-05T12:00:00Z"));
  });

  it("leaves tombstoned slides out of the search text", async () => {
    const doc = deck();
    tombstoneSlide(slidesMap(doc).get("b")!);
    await storeDocument(NAME, doc);
    expect(vi.mocked(indexPageBody).mock.calls[0][1]).not.toContain("Roadmap");
  });

  it("a failed index does not fail the save", async () => {
    vi.mocked(indexPageBody).mockRejectedValueOnce(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(storeDocument(NAME, deck())).resolves.not.toBeNull();
  });

  it("never writes a blocknote share", async () => {
    const doc = deck();
    await storeDocument(NAME, doc);
    expect(doc.share.has("blocknote")).toBe(false);
  });
});

describe("loadDocument for a slides room", () => {
  it("applies stored state and leaves the deck unchanged", async () => {
    const state = Y.encodeStateAsUpdate(deck());
    mockPrisma.collabDocument.findUnique.mockResolvedValue({ state: Buffer.from(state) });
    const doc = new Y.Doc();
    await loadDocument(NAME, doc);
    expect(projectLegacySlides(readDeck(doc)).map((s) => s.title)).toEqual(["Quarterly review", "Roadmap"]);
    expect(doc.share.has("blocknote")).toBe(false);
  });

  it("opens empty, without converting, when no row exists", async () => {
    mockPrisma.collabDocument.findUnique.mockResolvedValue(null);
    const doc = new Y.Doc();
    await loadDocument(NAME, doc);
    expect(slidesMap(doc).size).toBe(0);
    expect(doc.share.has("blocknote")).toBe(false);
  });
});

describe("forceSnapshot for a slides room", () => {
  it("snapshots the deck's text", async () => {
    await forceSnapshot(serverFor(deck()) as never, NAME, "Before enhance", ["u1"]);
    expect(mockPrisma.collabDocumentVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: NAME, label: "Before enhance", plainText: expect.stringContaining("Quarterly review") }),
    });
  });
});

describe("restoreVersion for a slides room", () => {
  it("restores slides and tombstones and never touches blocknote", async () => {
    const snapshot = deck();
    tombstoneSlide(slidesMap(snapshot).get("b")!);
    const live = deck();
    seedDeckDoc(new Y.Doc(), []);
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue({
      id: "v1",
      name: NAME,
      state: Buffer.from(Y.encodeStateAsUpdate(snapshot)),
    });

    await restoreVersion(serverFor(live) as never, NAME, "v1");

    expect(live.share.has("blocknote")).toBe(false);
    expect(isDeleted(slidesMap(live).get("b")!)).toBe(true);
    expect(projectLegacySlides(readDeck(live)).map((s) => s.title)).toEqual(["Quarterly review"]);
    expect(restoreEpochOf(live)).toBe(1);
  });

  it("rejects a version that belongs to another document", async () => {
    mockPrisma.collabDocumentVersion.findUnique.mockResolvedValue({ id: "v1", name: "slides:other:deck", state: Buffer.from([]) });
    await expect(restoreVersion(serverFor(deck()) as never, NAME, "v1")).rejects.toThrow("Version not found");
  });
});
