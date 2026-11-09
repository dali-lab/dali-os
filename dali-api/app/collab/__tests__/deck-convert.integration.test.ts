import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { prisma } from "~/lib/db.server";
import { convertDeckToYjs, deckSlideCount } from "~/collab/deck-convert.server";
import { readDeck } from "~/collab/read-deck.server";
import { slidesRoomName } from "~/collab/roomName";

const PAGE = "deck-page-1";
const SLIDES = [
  { id: "a", layout: "title", title: "Hello", subtitle: "Sub" },
  { id: "b", layout: "content", title: "Agenda" },
  { id: "c", layout: "image", title: "Photo", image: { src: "https://x/y.png", alt: "y" } },
];

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { id: "deck-user", email: "ada@example.edu", firstName: "Ada", lastName: "Lovelace" },
  });
  await prisma.page.create({
    data: { id: PAGE, workspaceType: "Lab", title: "Deck", kind: "Slides", createdById: user.id },
  });
  await prisma.slideDeck.create({ data: { pageId: PAGE, slides: SLIDES } });
});

const room = async () => prisma.collabDocument.findMany({ where: { name: slidesRoomName(PAGE) } });
const storage = async () => (await prisma.slideDeck.findUniqueOrThrow({ where: { pageId: PAGE } })).storage;

describe("convertDeckToYjs", () => {
  it("starts as json", async () => {
    expect(await storage()).toBe("json");
  });

  it("writes the room and flips storage once", async () => {
    expect(await convertDeckToYjs(PAGE)).toEqual({ converted: true });
    const rows = await room();
    expect(rows).toHaveLength(1);
    expect(deckSlideCount(new Uint8Array(rows[0].state))).toBe(3);
    expect(await storage()).toBe("yjs");
  });

  it("racing conversions: one converter, one identical stored state, no duplicate slides", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => convertDeckToYjs(PAGE)));
    expect(results.filter((r) => r.converted)).toHaveLength(1);
    const rows = await room();
    expect(rows).toHaveLength(1);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(rows[0].state));
    expect(readDeck(doc).slides.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(await storage()).toBe("yjs");
  });

  it("converting again is a no-op and keeps the stored state", async () => {
    await convertDeckToYjs(PAGE);
    const before = new Uint8Array((await room())[0].state);
    expect(await convertDeckToYjs(PAGE)).toEqual({ converted: false });
    expect(new Uint8Array((await room())[0].state)).toEqual(before);
  });

  it("creates the deck row for a page that never opened one and converts it to an empty deck", async () => {
    await prisma.slideDeck.delete({ where: { pageId: PAGE } });
    expect(await convertDeckToYjs(PAGE)).toEqual({ converted: true });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array((await room())[0].state));
    expect(readDeck(doc).slides).toEqual([]);
    expect(await storage()).toBe("yjs");
  });

  it("a deck row created without a storage value defaults to json", async () => {
    const other = await prisma.page.create({
      data: { id: "deck-page-2", workspaceType: "Lab", title: "Other", kind: "Slides", createdById: "deck-user" },
    });
    const row = await prisma.slideDeck.create({ data: { pageId: other.id } });
    expect(row.storage).toBe("json");
  });
});
