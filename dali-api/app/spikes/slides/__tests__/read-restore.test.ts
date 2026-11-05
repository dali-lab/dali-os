import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";

vi.mock("~/lib/db.server", () => ({
  prisma: { collabDocumentVersion: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/doc-search.server", () => ({ indexPageBody: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { getPlainText, restoreVersion } from "~/collab/persistence";
import {
  addSlide,
  addTextElement,
  initDeck,
  readDeck,
  restoreDeck,
  slidesMap,
  textFragment,
  tombstoneSlide,
} from "../deck-model";

function sampleDeck() {
  const doc = new Y.Doc();
  initDeck(doc);
  addSlide(doc, "s2", 2);
  addTextElement(doc, "s2", "body", undefined, "Second slide body");
  addSlide(doc, "s1", 1, "title");
  addTextElement(doc, "s1", "title", undefined, "Quarterly review");
  addTextElement(doc, "s1", "sub", undefined, "Searchable subtitle");
  addSlide(doc, "gone", 3);
  addTextElement(doc, "gone", "t", undefined, "Deleted slide text");
  tombstoneSlide(doc, "gone");
  const notes = slidesMap(doc).get("s1")!.get("notes") as Y.XmlFragment;
  const p = new Y.XmlElement("blockcontainer");
  notes.insert(0, [p]);
  return doc;
}

describe("readDeck", () => {
  it("decodes nested fragments to blocks and plain text, in slide order, skipping tombstones", () => {
    const doc = sampleDeck();
    const read = readDeck(doc);
    expect(read.v).toBe(1);
    expect(read.slides.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(read.slides[0].elements.map((e) => e.text).sort()).toEqual(["Quarterly review", "Searchable subtitle"]);
    expect(read.slides[1].elements[0].blocks[0].type).toBe("paragraph");
    expect(read.plainText).toContain("Quarterly review");
    expect(read.plainText).toContain("Second slide body");
    expect(read.plainText).not.toContain("Deleted slide text");
  });

  it("never mutates the live doc (decodes a clone)", () => {
    const doc = sampleDeck();
    const before = Y.encodeStateAsUpdate(doc);
    readDeck(doc);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(textFragment(doc, "s1", "title").length).toBeGreaterThan(0);
  });
});

describe("existing persistence paths against a slides room (confirming the review's blocker)", () => {
  it("getPlainText returns empty for a deck", () => {
    expect(getPlainText(sampleDeck())).toBe("");
  });

  it("restoreVersion leaves the slides untouched and writes into the blocknote fragment", async () => {
    const snapshotDoc = sampleDeck();
    const live = sampleDeck();
    tombstoneSlide(live, "s1");
    addSlide(live, "extra", 9);
    vi.mocked(prisma.collabDocumentVersion.findUnique).mockResolvedValue({
      id: "v1",
      name: "slides:p:deck",
      state: Buffer.from(Y.encodeStateAsUpdate(snapshotDoc)),
    } as never);
    const server = {
      hocuspocus: {
        openDirectConnection: async () => ({
          transact: async (fn: (d: Y.Doc) => void) => live.transact(() => fn(live)),
          disconnect: async () => {},
        }),
      },
    };
    expect(live.share.has("blocknote")).toBe(false);
    await restoreVersion(server as never, "slides:p:deck", "v1");

    expect(live.share.has("blocknote")).toBe(true);
    expect(slidesMap(live).get("s1")!.get("deleted")).toBe(true);
    expect(slidesMap(live).has("extra")).toBe(true);
  });
});

describe("restoreDeck", () => {
  it("replaces the live deck with the snapshot, in one transaction, never touching blocknote", () => {
    const snapshot = sampleDeck();
    const live = sampleDeck();
    tombstoneSlide(live, "s1");
    addSlide(live, "extra", 9);
    let updates = 0;
    live.on("update", () => updates++);

    restoreDeck(live, Y.encodeStateAsUpdate(snapshot));

    expect(updates).toBe(1);
    expect(live.share.has("blocknote")).toBe(false);
    const read = readDeck(live);
    expect(read.slides.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(read.plainText).toContain("Quarterly review");
    expect(slidesMap(live).has("extra")).toBe(false);
  });

  it("a connected peer converges on the restored content", () => {
    const snapshot = sampleDeck();
    const live = sampleDeck();
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(live));
    live.on("update", (u: Uint8Array) => Y.applyUpdate(peer, u));
    tombstoneSlide(live, "s1");
    restoreDeck(live, Y.encodeStateAsUpdate(snapshot));
    expect(readDeck(peer).plainText).toBe(readDeck(snapshot).plainText);
    expect(slidesMap(peer).get("s1")!.get("deleted")).toBe(false);
  });
});
