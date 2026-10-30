import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Slide } from "~/components/slides/types";

const store = vi.hoisted(() => ({ slides: [] as Slide[] }));
const decks = vi.hoisted(() => ({
  deckAccess: vi.fn(),
  loadDeck: vi.fn(),
  editDeck: vi.fn(),
}));

vi.mock("~/lib/slide-decks.server", () => decks);
// Markdown <-> blocks is BlockNote's job; a one-paragraph stand-in keeps the
// tool's own logic in view.
vi.mock("~/collab/blocknote-server", () => ({
  markdownToBlocks: vi.fn(async (md: string) => [{ type: "paragraph", content: [{ type: "text", text: md }] }]),
  blocksToMarkdown: vi.fn(async (blocks: { content: { text: string }[] }[]) => blocks.map((b) => b.content[0].text).join("\n")),
}));

import { runManageSlideDeck } from "../manage-slide-deck";

const s = (id: string, title = id): Slide => ({ id, layout: "title", title });

beforeEach(() => {
  vi.clearAllMocks();
  store.slides = [s("a"), s("b"), s("c")];
  decks.deckAccess.mockResolvedValue({ ok: true, page: { id: "p1", title: "Deck", iconEmoji: null }, canEdit: true });
  decks.loadDeck.mockImplementation(async () => ({ slides: store.slides, version: "v1" }));
  decks.editDeck.mockImplementation(async (_u: string, _p: string, fn: (x: Slide[]) => Promise<Slide[]>) => {
    store.slides = await fn(store.slides);
    return { ok: true, slides: store.slides, version: "v2" };
  });
});

const ids = () => store.slides.map((x) => x.id);

describe("manage_slide_deck", () => {
  it("get returns the title, version and slides with Markdown bodies", async () => {
    store.slides = [{ id: "a", layout: "content", title: "A", body: [{ type: "paragraph", content: [{ type: "text", text: "- one" }] }] as never }];
    expect(await runManageSlideDeck("u1", { action: "get", pageId: "p1" })).toEqual({
      title: "Deck",
      version: "v1",
      slides: [{ id: "a", layout: "content", title: "A", bodyMarkdown: "- one" }],
      page: { nextCursor: null, hasMore: false, limit: 50, total: 1 },
    });
    expect(decks.editDeck).not.toHaveBeenCalled();
  });

  it("get pages the slides in order and the last page has no cursor", async () => {
    store.slides = ["a", "b", "c"].map((id) => s(id));
    const first = await runManageSlideDeck("u1", { action: "get", pageId: "p1", limit: 2 });
    expect(first).toMatchObject({ slides: [{ id: "a" }, { id: "b" }], page: { hasMore: true, limit: 2, total: 3 } });
    const second = await runManageSlideDeck("u1", {
      action: "get",
      pageId: "p1",
      limit: 2,
      cursor: (first as { page: { nextCursor: string } }).page.nextCursor,
    });
    expect(second).toMatchObject({ slides: [{ id: "c" }], page: { nextCursor: null, hasMore: false } });
  });

  it("edit actions still echo the whole deck without a page", async () => {
    const out = await runManageSlideDeck("u1", { action: "add_slide", pageId: "p1", slide: { title: "d" }, limit: 1 });
    expect(out).not.toHaveProperty("page");
    expect(out.slides).toHaveLength(4);
  });

  it("set_slides replaces the deck", async () => {
    const out = await runManageSlideDeck("u1", {
      action: "set_slides",
      pageId: "p1",
      slides: [{ layout: "title", title: "New" }, { layout: "content", title: "Two", bodyMarkdown: "hi" }],
    });
    expect(store.slides.map((x) => x.title)).toEqual(["New", "Two"]);
    expect(store.slides[1].body).toEqual([{ type: "paragraph", content: [{ type: "text", text: "hi" }] }]);
    expect(out).toMatchObject({ title: "Deck", version: "v2" });
  });

  it("add_slide appends by default and inserts at an index", async () => {
    await runManageSlideDeck("u1", { action: "add_slide", pageId: "p1", slide: { title: "end" } });
    expect(store.slides.at(-1)?.title).toBe("end");
    await runManageSlideDeck("u1", { action: "add_slide", pageId: "p1", slide: { title: "first" }, index: 0 });
    expect(store.slides[0].title).toBe("first");
  });

  it("add_slide clamps an index past the end", async () => {
    await runManageSlideDeck("u1", { action: "add_slide", pageId: "p1", slide: { title: "x" }, index: 99 });
    expect(store.slides.at(-1)?.title).toBe("x");
  });

  it("update_slide keeps the fields it isn't given", async () => {
    store.slides = [{ id: "a", layout: "split", title: "Old", notes: "keep", image: { src: "/a.png", alt: "A" } }];
    await runManageSlideDeck("u1", { action: "update_slide", pageId: "p1", slideId: "a", slide: { title: "New" } });
    expect(store.slides[0]).toEqual({ id: "a", layout: "split", title: "New", notes: "keep", image: { src: "/a.png", alt: "A" } });
  });

  it("delete_slide removes it", async () => {
    await runManageSlideDeck("u1", { action: "delete_slide", pageId: "p1", slideId: "b" });
    expect(ids()).toEqual(["a", "c"]);
  });

  it("move_slide moves to the target index, clamped to the deck", async () => {
    await runManageSlideDeck("u1", { action: "move_slide", pageId: "p1", slideId: "a", toIndex: 2 });
    expect(ids()).toEqual(["b", "c", "a"]);
    await runManageSlideDeck("u1", { action: "move_slide", pageId: "p1", slideId: "a", toIndex: 50 });
    expect(ids()).toEqual(["b", "c", "a"]);
  });

  it("reports an unknown slide id as not found", async () => {
    await expect(runManageSlideDeck("u1", { action: "delete_slide", pageId: "p1", slideId: "zz" })).rejects.toMatchObject({ status: 404 });
  });

  it("requires each action's fields", async () => {
    await expect(runManageSlideDeck("u1", { action: "update_slide", pageId: "p1", slideId: "a" })).rejects.toMatchObject({ status: 400 });
    await expect(runManageSlideDeck("u1", { action: "move_slide", pageId: "p1", slideId: "a" })).rejects.toMatchObject({ status: 400 });
  });

  it("passes on access and save failures with their status", async () => {
    decks.deckAccess.mockResolvedValueOnce({ ok: false, status: 404, error: "Slide deck not found." });
    await expect(runManageSlideDeck("u1", { action: "get", pageId: "p1" })).rejects.toMatchObject({ status: 404 });
    decks.editDeck.mockResolvedValueOnce({ ok: false, status: 403, error: "You can view this deck but not edit it." });
    await expect(runManageSlideDeck("u1", { action: "delete_slide", pageId: "p1", slideId: "a" })).rejects.toMatchObject({ status: 403 });
  });
});
