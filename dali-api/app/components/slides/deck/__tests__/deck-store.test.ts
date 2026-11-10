import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { blocksToFragment } from "~/collab/blocknote-server";
import { addSlide, deleteSlide, moveSlide, setLayout, setThemeId, slideFragment } from "../deck-ops";
import { createDeckStore } from "../deck-store";
import { deckMap, initDeck, restoreEpochOf } from "../model";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

function deck(n = 3) {
  const doc = new Y.Doc();
  initDeck(doc);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(addSlide(doc, "content", ids[i - 1] ?? null));
  return { doc, ids };
}

describe("deck store", () => {
  it("starts with the deck as it is, in order, with the deck fields", () => {
    const { doc, ids } = deck();
    const snap = createDeckStore(doc).getSnapshot();
    expect(snap.slides.map((s) => s.id)).toEqual(ids);
    expect(snap).toMatchObject({ v: 1, themeId: "dali-dark", epoch: 0 });
  });

  it("re-reads only the slide a text edit touched", async () => {
    const { doc, ids } = deck();
    const store = createDeckStore(doc);
    const before = store.getSnapshot();
    blocksToFragment([{ type: "paragraph", content: "Hi" }] as never, slideFragment(doc, ids[1], "title")!);
    await tick();
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.slides[0]).toBe(before.slides[0]);
    expect(after.slides[2]).toBe(before.slides[2]);
    expect(after.slides[1]).not.toBe(before.slides[1]);
    expect(after.slides[1].elements.find((e) => e.slot === "title")!.blocks).toHaveLength(1);
  });

  it("follows adds, moves, layout and theme changes, notifying subscribers once per batch", async () => {
    const { doc, ids } = deck();
    const store = createDeckStore(doc);
    const listener = vi.fn();
    store.subscribe(listener);
    const extra = addSlide(doc, "title", null);
    moveSlide(doc, extra, 0);
    setLayout(doc, ids[0], "split");
    setThemeId(doc, "dali-light");
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
    const snap = store.getSnapshot();
    expect(snap.slides.map((s) => s.id)).toEqual([extra, ...ids]);
    expect(snap.slides[1].layoutId).toBe("split");
    expect(snap.themeId).toBe("dali-light");
  });

  it("moves a deleted slide to the tombstones with who deleted it, and brings it back", async () => {
    const { doc, ids } = deck();
    const store = createDeckStore(doc);
    deleteSlide(doc, ids[1], "Ada");
    await tick();
    expect(store.getSnapshot().slides.map((s) => s.id)).toEqual([ids[0], ids[2]]);
    expect(store.getSnapshot().deletedBy).toEqual({ [ids[1]]: "Ada" });
    doc.transact(() => doc.getMap<Y.Map<unknown>>("slides").get(ids[1])!.set("deleted", false));
    await tick();
    expect(store.getSnapshot().slides).toHaveLength(3);
    expect(store.getSnapshot().deletedIds).toEqual([]);
  });

  it("rebuilds everything when the restore epoch changes", async () => {
    const { doc } = deck();
    const store = createDeckStore(doc);
    const before = store.getSnapshot().slides[0];
    doc.transact(() => deckMap(doc).set("restoreEpoch", restoreEpochOf(doc) + 1));
    await tick();
    expect(store.getSnapshot().epoch).toBe(1);
    expect(store.getSnapshot().slides[0]).not.toBe(before);
  });

  it("stops observing after destroy", async () => {
    const { doc } = deck();
    const store = createDeckStore(doc);
    const listener = vi.fn();
    store.subscribe(listener);
    store.destroy();
    addSlide(doc, "content", null);
    await tick();
    expect(listener).not.toHaveBeenCalled();
  });
});
