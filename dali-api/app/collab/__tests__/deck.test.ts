import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));

import { applySlides, restoreDeck, seedDeckDoc } from "../deck-write.server";
import { deckSlideCount, loadOrConvertDeck, type ConversionStore } from "../deck-convert.server";
import { notesBySlide, projectLegacySlides, readDeck, toRenderDeck } from "../read-deck.server";
import {
  deckMap,
  elementsOf,
  isDeleted,
  restoreEpochOf,
  slidesMap,
  textOf,
  tombstoneSlide,
} from "~/components/slides/deck/model";
import type { Slide } from "~/components/slides/types";
import { addShape, addTextBox, groupElements, moveElements } from "~/components/slides/deck/freeform-ops";
import { setLayout } from "~/components/slides/deck/deck-ops";

const LEGACY: Slide[] = [
  { id: "a", layout: "title", title: "Hello", subtitle: "Sub", notes: "say hi" },
  { id: "b", layout: "content", title: "Agenda", body: [{ type: "paragraph", content: "one two" }] as never },
  { id: "c", layout: "image", title: "Photo", image: { src: "https://x/y.png", alt: "y" } },
];

const seeded = (slides: Slide[] = LEGACY) => {
  const doc = new Y.Doc();
  seedDeckDoc(doc, slides);
  return doc;
};

const titles = (doc: Y.Doc) => projectLegacySlides(readDeck(doc)).map((s) => s.title);

describe("seedDeckDoc", () => {
  it("maps legacy slides to keyed slides with text fragments, notes and image elements", () => {
    const read = readDeck(seeded());
    expect(deckMap(seeded()).get("v")).toBe(1);
    expect(read.slides.map((s) => [s.id, s.layoutId])).toEqual([["a", "title"], ["b", "content"], ["c", "image"]]);
    expect(read.slides[0].notes.text).toBe("say hi");
    expect(read.slides[1].elements.find((e) => e.slot === "body")!.text).toBe("one two");
    expect(read.slides[2].elements.find((e) => e.slot === "image")).toMatchObject({ src: "https://x/y.png", alt: "y" });
    expect(read.plainText).toContain("Hello");
    expect(read.plainText).toContain("say hi");
  });

  it("round-trips through the legacy projection", () => {
    const out = projectLegacySlides(readDeck(seeded()));
    expect(out.map((s) => [s.id, s.layout, s.title, s.subtitle, s.notes])).toEqual([
      ["a", "title", "Hello", "Sub", "say hi"],
      ["b", "content", "Agenda", undefined, undefined],
      ["c", "image", "Photo", undefined, undefined],
    ]);
    expect(out[2].image).toEqual({ src: "https://x/y.png", alt: "y" });
  });

  it("starts at restore epoch 0", () => {
    expect(restoreEpochOf(seeded())).toBe(0);
  });
});

describe("readDeck", () => {
  it("skips tombstoned slides and elements and returns slides in position order", () => {
    const doc = seeded();
    tombstoneSlide(slidesMap(doc).get("b")!);
    elementsOf(slidesMap(doc).get("a")!).get("subtitle")!.set("deleted", true);
    slidesMap(doc).get("c")!.set("pos", 0.5);
    const read = readDeck(doc);
    expect(read.slides.map((s) => s.id)).toEqual(["c", "a"]);
    expect(read.slides[1].elements.map((e) => e.slot)).toEqual(["title"]);
    expect(read.plainText).not.toContain("Agenda");
    expect(read.plainText).not.toContain("Sub");
  });

  it("never mutates the live doc", () => {
    const doc = seeded();
    const before = Y.encodeStateAsUpdate(doc);
    readDeck(doc);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it("reports an unknown deck version for the read-only gate", () => {
    const doc = seeded();
    deckMap(doc).set("v", 2);
    expect(readDeck(doc).v).toBe(2);
  });

  it("maps an unknown layout id to content in the legacy projection", () => {
    const doc = seeded();
    slidesMap(doc).get("a")!.set("layoutId", "two-column");
    expect(projectLegacySlides(readDeck(doc))[0].layout).toBe("content");
  });

  it("projects the section and big number layouts to the title layout with the same output shape", () => {
    const doc = seeded();
    slidesMap(doc).get("a")!.set("layoutId", "section");
    slidesMap(doc).get("b")!.set("layoutId", "bignumber");
    const out = projectLegacySlides(readDeck(doc));
    expect(out.slice(0, 2).map((s) => s.layout)).toEqual(["title", "title"]);
    expect(Object.keys(out[0]).sort()).toEqual(Object.keys(projectLegacySlides(readDeck(seeded()))[0]).sort());
  });

  it("an MCP write that echoes the projected layout keeps the richer layout id", () => {
    const doc = seeded();
    slidesMap(doc).get("a")!.set("layoutId", "section");
    applySlides(doc, projectLegacySlides(readDeck(doc)));
    expect(slidesMap(doc).get("a")!.get("layoutId")).toBe("section");
    applySlides(doc, projectLegacySlides(readDeck(doc)).map((s) => (s.id === "a" ? { ...s, layout: "content" as const } : s)));
    expect(slidesMap(doc).get("a")!.get("layoutId")).toBe("content");
  });
});

describe("applySlides", () => {
  it("tombstones removed slides instead of deleting them", () => {
    const doc = seeded();
    applySlides(doc, LEGACY.filter((s) => s.id !== "b"));
    expect(slidesMap(doc).has("b")).toBe(true);
    expect(isDeleted(slidesMap(doc).get("b")!)).toBe(true);
    expect(titles(doc)).toEqual(["Hello", "Photo"]);
  });

  it("revives a tombstoned slide that comes back", () => {
    const doc = seeded();
    applySlides(doc, LEGACY.filter((s) => s.id !== "b"));
    applySlides(doc, LEGACY);
    expect(titles(doc)).toEqual(["Hello", "Agenda", "Photo"]);
  });

  it("reorders by changing positions only where needed", () => {
    const doc = seeded();
    const posBefore = (id: string) => slidesMap(doc).get(id)!.get("pos");
    const aPos = posBefore("a");
    applySlides(doc, [LEGACY[0], LEGACY[2], LEGACY[1]]);
    expect(titles(doc)).toEqual(["Hello", "Photo", "Agenda"]);
    expect(posBefore("a")).toBe(aPos);
  });

  it("inserts a new slide between neighbours", () => {
    const doc = seeded();
    applySlides(doc, [LEGACY[0], { id: "n", layout: "content", title: "New" }, LEGACY[1], LEGACY[2]]);
    expect(titles(doc)).toEqual(["Hello", "New", "Agenda", "Photo"]);
  });

  it("rewrites only the slot that changed and keeps the other fragments", () => {
    const doc = seeded();
    const subtitleFrag = textOf(slidesMap(doc).get("a")!).get("subtitle");
    const current = projectLegacySlides(readDeck(doc));
    applySlides(doc, current.map((s) => (s.id === "a" ? { ...s, title: "Hello again" } : s)));
    expect(titles(doc)[0]).toBe("Hello again");
    expect(textOf(slidesMap(doc).get("a")!).get("subtitle")).toBe(subtitleFrag);
    expect(projectLegacySlides(readDeck(doc))[0].subtitle).toBe("Sub");
  });

  it("tombstones an element whose slot is cleared and its slide keeps the rest", () => {
    const doc = seeded();
    const current = projectLegacySlides(readDeck(doc));
    applySlides(doc, current.map((s) => (s.id === "c" ? { ...s, image: undefined } : s)));
    const el = elementsOf(slidesMap(doc).get("c")!).get("image")!;
    expect(isDeleted(el)).toBe(false);
    expect(el.get("src")).toBe("");
    expect(projectLegacySlides(readDeck(doc))[2].image).toBeUndefined();
  });

  it("a peer typing in a slide that stays is unaffected by an edit elsewhere", () => {
    const doc = seeded();
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    doc.on("update", (u: Uint8Array) => Y.applyUpdate(peer, u));
    const current = projectLegacySlides(readDeck(doc));
    applySlides(doc, current.map((s) => (s.id === "b" ? { ...s, title: "Agenda 2" } : s)));
    expect(titles(peer)).toEqual(["Hello", "Agenda 2", "Photo"]);
  });
});

describe("restoreDeck", () => {
  it("replaces the live deck with the snapshot in one transaction and never creates a blocknote share", () => {
    const snapshot = seeded();
    const live = seeded();
    applySlides(live, [{ id: "extra", layout: "content", title: "Extra" }]);
    let updates = 0;
    live.on("update", () => updates++);

    restoreDeck(live, Y.encodeStateAsUpdate(snapshot));

    expect(updates).toBe(1);
    expect(live.share.has("blocknote")).toBe(false);
    expect(titles(live)).toEqual(["Hello", "Agenda", "Photo"]);
    expect(slidesMap(live).has("extra")).toBe(false);
  });

  it("restores tombstones from the snapshot", () => {
    const snapshot = seeded();
    tombstoneSlide(slidesMap(snapshot).get("b")!);
    const live = seeded();
    restoreDeck(live, Y.encodeStateAsUpdate(snapshot));
    expect(isDeleted(slidesMap(live).get("b")!)).toBe(true);
    expect(titles(live)).toEqual(["Hello", "Photo"]);
  });

  it("bumps the restore epoch on every restore", () => {
    const snapshot = Y.encodeStateAsUpdate(seeded());
    const live = seeded();
    restoreDeck(live, snapshot);
    expect(restoreEpochOf(live)).toBe(1);
    restoreDeck(live, snapshot);
    expect(restoreEpochOf(live)).toBe(2);
  });

  it("a connected peer converges and sees the new epoch", () => {
    const snapshot = seeded();
    const live = seeded();
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(live));
    live.on("update", (u: Uint8Array) => Y.applyUpdate(peer, u));
    tombstoneSlide(slidesMap(live).get("a")!);
    restoreDeck(live, Y.encodeStateAsUpdate(snapshot));
    expect(readDeck(peer).plainText).toBe(readDeck(snapshot).plainText);
    expect(restoreEpochOf(peer)).toBe(1);
  });
});

function memoryStore(legacy: Slide[]) {
  const rows = new Map<string, Uint8Array>();
  const state = { flips: 0, reads: 0 };
  let chain: Promise<unknown> = Promise.resolve();
  const store: ConversionStore = {
    withLock(_name, fn) {
      const run = chain.then(() =>
        fn({
          getState: async (n) => rows.get(n) ?? null,
          putState: async (n, s) => void rows.set(n, s),
          flipStorage: async () => {
            state.flips++;
            return true;
          },
          readLegacy: async () => {
            state.reads++;
            return legacy;
          },
        }),
      );
      chain = run.catch(() => {});
      return run;
    },
  };
  return { store, rows, state };
}

describe("loadOrConvertDeck with a fake lock", () => {
  it("two racing conversions: one converts, the other returns the stored state", async () => {
    const { store, state } = memoryStore(LEGACY);
    const [r1, r2] = await Promise.all([loadOrConvertDeck(store, "slides:p:deck"), loadOrConvertDeck(store, "slides:p:deck")]);
    expect([r1.converted, r2.converted].sort()).toEqual([false, true]);
    expect(r1.state).toEqual(r2.state);
    expect(deckSlideCount(r1.state)).toBe(3);
    expect(state.reads).toBe(1);
  });

  it("an existing room state wins and is not reseeded", async () => {
    const { store, rows, state } = memoryStore(LEGACY);
    const existing = Y.encodeStateAsUpdate(seeded([LEGACY[0]]));
    rows.set("slides:p:deck", existing);
    const result = await loadOrConvertDeck(store, "slides:p:deck");
    expect(result).toEqual({ state: existing, converted: false });
    expect(state.reads).toBe(0);
    expect(state.flips).toBe(1);
  });

  it("an empty legacy deck converts to a valid empty deck", async () => {
    const { store } = memoryStore([]);
    const { state } = await loadOrConvertDeck(store, "slides:p:deck");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    expect(deckMap(doc).get("v")).toBe(1);
    expect(readDeck(doc).slides).toEqual([]);
  });

  it("does not write when reading the legacy deck fails", async () => {
    const { store, rows } = memoryStore(LEGACY);
    const failing: ConversionStore = {
      withLock: (name, fn) =>
        store.withLock(name, (tx) =>
          fn({ ...tx, readLegacy: async () => { throw new Error("boom"); } }),
        ),
    };
    await expect(loadOrConvertDeck(failing, "slides:p:deck")).rejects.toThrow("boom");
    expect(rows.size).toBe(0);
  });
});

describe("builds on a deck", () => {
  const withBuilds = () => {
    const doc = seeded();
    const body = elementsOf(slidesMap(doc).get("b")!).get("body")!;
    body.set("build", 2);
    body.set("buildBullets", true);
    return doc;
  };

  it("reads builds into the render deck, and leaves the keys off elements without them", () => {
    const read = readDeck(withBuilds());
    const elements = read.slides[1].elements;
    expect(elements.find((e) => e.slot === "body")).toMatchObject({ build: 2, buildBullets: true });
    expect("build" in elements.find((e) => e.slot === "title")!).toBe(false);
    const render = toRenderDeck(read);
    expect(render.slides[1].elements.find((e) => e.slot === "body")).toMatchObject({ build: 2, buildBullets: true });
    expect("build" in render.slides[0].elements[0]).toBe(false);
  });

  it("projects the same legacy slides with or without builds", () => {
    const doc = seeded();
    const before = projectLegacySlides(readDeck(doc));
    const body = elementsOf(slidesMap(doc).get("b")!).get("body")!;
    body.set("build", 2);
    body.set("buildBullets", true);
    expect(projectLegacySlides(readDeck(doc))).toEqual(before);
  });

  it("returns each slide's notes text for the presenter view", () => {
    expect(notesBySlide(readDeck(seeded()))).toEqual({ a: "say hi", b: "", c: "" });
  });
});

describe("freeform elements on the server read path", () => {
  it("reads geometry, rotation, shape, fill and group children, and carries them into the render deck", () => {
    const doc = seeded();
    setLayout(doc, "a", "blank");
    const shape = addShape(doc, "a", "arrow", { x: 700, y: 500 })!;
    const text = addTextBox(doc, "a")!;
    const group = groupElements(doc, "a", [shape, text])!;
    const read = readDeck(doc).slides.find((s) => s.id === "a")!;
    expect(read.elements.find((e) => e.id === shape)).toMatchObject({ kind: "shape", slot: null, shape: "arrow", fill: "accent", w: 480, h: 56 });
    expect(read.elements.find((e) => e.id === group)).toMatchObject({ kind: "group", children: [shape, text] });
    const render = toRenderDeck(readDeck(doc)).slides.find((s) => s.id === "a")!;
    expect(render.elements.find((e) => e.id === shape)).toMatchObject({ parentId: group, shape: "arrow", w: 480 });
  });

  it("keeps free text in the deck's searchable text and leaves free elements out of the legacy projection", () => {
    const doc = seeded();
    const text = addTextBox(doc, "b")!;
    textOf(slidesMap(doc).get("b")!).get(text)!.insert(0, []);
    const before = projectLegacySlides(readDeck(doc)).find((s) => s.id === "b")!;
    expect(before.title).toBe("Agenda");
    expect(JSON.stringify(before)).not.toContain(text);
  });

  it("reports a detached slot's geometry and projects it back to the same legacy slide", () => {
    const doc = seeded();
    moveElements(doc, "b", ["body"], 10, 10);
    const read = readDeck(doc).slides.find((s) => s.id === "b")!;
    expect(read.elements.find((e) => e.id === "body")).toMatchObject({ slot: "body", x: 170, y: 320 });
    expect(projectLegacySlides(readDeck(doc)).find((s) => s.id === "b")!.body).toBeDefined();
  });

  it("maps the blank layout to the closest legacy layout", () => {
    const doc = seeded();
    setLayout(doc, "b", "blank");
    expect(projectLegacySlides(readDeck(doc)).find((s) => s.id === "b")!.layout).toBe("content");
  });
});
