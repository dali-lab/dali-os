import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const db = vi.hoisted(() => ({
  slideDeck: { findUnique: vi.fn(), createMany: vi.fn() },
  collabDocument: { findUnique: vi.fn(), createMany: vi.fn() },
}));

vi.mock("~/lib/db.server", () => ({ prisma: db }));

import { emptyDeckState, ensureLiveDeck } from "~/lib/live-deck.server";
import { readDeck } from "~/collab/read-deck.server";
import { deckAccessMode } from "~/components/slides/deck/model";

beforeEach(() => {
  vi.clearAllMocks();
  db.slideDeck.findUnique.mockResolvedValue(null);
  db.collabDocument.findUnique.mockResolvedValue(null);
});

describe("emptyDeckState", () => {
  it("is an editable deck with no slides", () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, emptyDeckState());
    const read = readDeck(doc);
    expect(deckAccessMode(read.v)).toBe("edit");
    expect(read.slides).toEqual([]);
  });
});

describe("ensureLiveDeck", () => {
  it("creates a row and an empty room for a page with neither", async () => {
    await ensureLiveDeck("p1", "u1");
    expect(db.slideDeck.createMany).toHaveBeenCalledWith({
      data: [{ pageId: "p1", lastEditedById: "u1" }],
      skipDuplicates: true,
    });
    const { data, skipDuplicates } = db.collabDocument.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data[0].name).toBe("slides:p1:deck");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(data[0].state));
    expect(deckAccessMode(readDeck(doc).v)).toBe("edit");
  });

  it("leaves a deck that already has a row and a room untouched", async () => {
    db.slideDeck.findUnique.mockResolvedValue({ pageId: "p1" });
    db.collabDocument.findUnique.mockResolvedValue({ name: "slides:p1:deck" });
    await ensureLiveDeck("p1");
    expect(db.slideDeck.createMany).not.toHaveBeenCalled();
    expect(db.collabDocument.createMany).not.toHaveBeenCalled();
  });

  it("adds only the missing room when the row exists", async () => {
    db.slideDeck.findUnique.mockResolvedValue({ pageId: "p1" });
    await ensureLiveDeck("p1");
    expect(db.slideDeck.createMany).not.toHaveBeenCalled();
    expect(db.collabDocument.createMany).toHaveBeenCalledTimes(1);
  });

  it("adds only the missing row when the room exists", async () => {
    db.collabDocument.findUnique.mockResolvedValue({ name: "slides:p1:deck" });
    await ensureLiveDeck("p1");
    expect(db.slideDeck.createMany).toHaveBeenCalledTimes(1);
    expect(db.collabDocument.createMany).not.toHaveBeenCalled();
  });

  it("omits the editor when none is given", async () => {
    await ensureLiveDeck("p1");
    expect(db.slideDeck.createMany.mock.calls[0][0].data).toEqual([{ pageId: "p1" }]);
  });
});
