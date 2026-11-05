import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { Slide } from "~/components/slides/types";

const env = vi.hoisted(() => ({ doc: null as unknown as Y.Doc, pageUpdate: vi.fn(), transact: vi.fn() }));
const decks = vi.hoisted(() => ({ deckAccess: vi.fn(), loadDeck: vi.fn(), editDeck: vi.fn(), deckStorage: vi.fn() }));

vi.mock("~/lib/slide-decks.server", () => decks);
vi.mock("~/lib/db.server", () => ({ prisma: { page: { update: env.pageUpdate } } }));
vi.mock("~/collab/deck-live.server", () => ({
  transactDeck: env.transact.mockImplementation(async (_p: string, _u: string, fn: (d: Y.Doc) => void) => env.doc.transact(() => fn(env.doc))),
}));
vi.mock("~/collab/blocknote-server", async (importOriginal) => importOriginal());

import { runManageSlideDeck } from "../manage-slide-deck";
import { seedDeckDoc } from "~/collab/deck-write.server";
import { projectLegacySlides, readDeck } from "~/collab/read-deck.server";
import { elementsOf, isDeleted, slidesMap } from "~/components/slides/deck/model";

const LEGACY: Slide[] = [
  { id: "a", layout: "title", title: "Alpha", subtitle: "Sub" },
  { id: "b", layout: "content", title: "Beta" },
  { id: "c", layout: "split", title: "Gamma", notes: "n" },
];

const live = () => projectLegacySlides(readDeck(env.doc));
const ids = () => live().map((s) => s.id);

beforeEach(() => {
  vi.clearAllMocks();
  env.doc = new Y.Doc();
  seedDeckDoc(env.doc, LEGACY);
  decks.deckStorage.mockResolvedValue("yjs");
  decks.deckAccess.mockResolvedValue({ ok: true, page: { id: "p1", title: "Deck", iconEmoji: null }, canEdit: true });
  decks.loadDeck.mockImplementation(async () => ({ slides: live(), version: "v1", storage: "yjs" }));
});

describe("manage_slide_deck on a live deck", () => {
  it("get returns the legacy output shape", async () => {
    const out = await runManageSlideDeck("u1", { action: "get", pageId: "p1" });
    expect(out).toMatchObject({
      title: "Deck",
      version: "v1",
      page: { nextCursor: null, hasMore: false, limit: 50, total: 3 },
    });
    expect(out.slides.map((s) => [s.id, s.layout, s.title])).toEqual([
      ["a", "title", "Alpha"],
      ["b", "content", "Beta"],
      ["c", "split", "Gamma"],
    ]);
    expect(out.slides[0]).toMatchObject({ subtitle: "Sub" });
    expect(out.slides[2]).toMatchObject({ notes: "n" });
    expect(decks.editDeck).not.toHaveBeenCalled();
  });

  it("get ignores builds, so a deck with them reads exactly as one without", async () => {
    const before = await runManageSlideDeck("u1", { action: "get", pageId: "p1" });
    const title = elementsOf(slidesMap(env.doc).get("b")!).get("title")!;
    title.set("build", 2);
    title.set("buildBullets", true);
    elementsOf(slidesMap(env.doc).get("a")!).get("title")!.set("build", 1);
    const after = await runManageSlideDeck("u1", { action: "get", pageId: "p1" });
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain("build");
  });

  it("get keeps the same output shape for decks edited with the new section and big number layouts", async () => {
    slidesMap(env.doc).get("a")!.set("layoutId", "section");
    slidesMap(env.doc).get("b")!.set("layoutId", "bignumber");
    const out = await runManageSlideDeck("u1", { action: "get", pageId: "p1" });
    expect(out.slides.map((s) => [s.id, s.layout])).toEqual([["a", "title"], ["b", "title"], ["c", "split"]]);
    expect(Object.keys(out.slides[0]).sort()).toEqual(["id", "layout", "subtitle", "title"]);
  });

  it("never goes through the JSON compare-and-set", async () => {
    await runManageSlideDeck("u1", { action: "delete_slide", pageId: "p1", slideId: "a" });
    expect(decks.editDeck).not.toHaveBeenCalled();
    expect(env.transact).toHaveBeenCalledWith("p1", "u1", expect.any(Function));
    expect(env.pageUpdate).toHaveBeenCalledWith({ where: { id: "p1" }, data: { lastEditedById: "u1" } });
  });

  it("delete_slide tombstones the slide", async () => {
    const out = await runManageSlideDeck("u1", { action: "delete_slide", pageId: "p1", slideId: "b" });
    expect(isDeleted(slidesMap(env.doc).get("b")!)).toBe(true);
    expect(ids()).toEqual(["a", "c"]);
    expect(out.slides.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("add_slide inserts at an index and keeps existing slide ids", async () => {
    await runManageSlideDeck("u1", { action: "add_slide", pageId: "p1", slide: { title: "New" }, index: 1 });
    expect(live().map((s) => s.title)).toEqual(["Alpha", "New", "Beta", "Gamma"]);
    expect(ids()).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("update_slide changes the given fields and keeps the rest", async () => {
    await runManageSlideDeck("u1", { action: "update_slide", pageId: "p1", slideId: "a", slide: { title: "Alpha 2" } });
    expect(live()[0]).toMatchObject({ id: "a", title: "Alpha 2", subtitle: "Sub", layout: "title" });
  });

  it("move_slide reorders without recreating slides", async () => {
    const before = slidesMap(env.doc).get("a");
    await runManageSlideDeck("u1", { action: "move_slide", pageId: "p1", slideId: "a", toIndex: 2 });
    expect(ids()).toEqual(["b", "c", "a"]);
    expect(slidesMap(env.doc).get("a")).toBe(before);
  });

  it("set_slides replaces the deck and tombstones what it drops", async () => {
    await runManageSlideDeck("u1", {
      action: "set_slides",
      pageId: "p1",
      slides: [{ layout: "title", title: "Only" }],
    });
    expect(live().map((s) => s.title)).toEqual(["Only"]);
    for (const id of ["a", "b", "c"]) expect(isDeleted(slidesMap(env.doc).get(id)!)).toBe(true);
  });

  it("reports an unknown slide id as not found and writes nothing", async () => {
    await expect(runManageSlideDeck("u1", { action: "delete_slide", pageId: "p1", slideId: "zz" })).rejects.toMatchObject({ status: 404 });
    expect(env.transact).not.toHaveBeenCalled();
  });

  it("refuses edits from a viewer", async () => {
    decks.deckAccess.mockResolvedValue({ ok: true, page: { id: "p1", title: "Deck", iconEmoji: null }, canEdit: false });
    await expect(runManageSlideDeck("u1", { action: "delete_slide", pageId: "p1", slideId: "a" })).rejects.toMatchObject({ status: 403 });
    expect(env.transact).not.toHaveBeenCalled();
  });

  it("a viewer can still get", async () => {
    decks.deckAccess.mockResolvedValue({ ok: true, page: { id: "p1", title: "Deck", iconEmoji: null }, canEdit: false });
    await expect(runManageSlideDeck("u1", { action: "get", pageId: "p1" })).resolves.toMatchObject({ title: "Deck" });
  });
});

describe("manage_slide_deck on a JSON deck", () => {
  it("still edits through editDeck", async () => {
    decks.deckStorage.mockResolvedValue("json");
    decks.editDeck.mockImplementation(async (_u: string, _p: string, fn: (x: Slide[]) => Promise<Slide[]>) => {
      const slides = await fn(LEGACY);
      return { ok: true, slides, version: "v2" };
    });
    const out = await runManageSlideDeck("u1", { action: "delete_slide", pageId: "p1", slideId: "a" });
    expect(decks.editDeck).toHaveBeenCalled();
    expect(env.transact).not.toHaveBeenCalled();
    expect(out.slides.map((s) => s.id)).toEqual(["b", "c"]);
  });
});
