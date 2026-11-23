import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));

import { restoreDeck } from "../deck-write.server";
import { notesBySlide, readDeck, toRenderDeck } from "../read-deck.server";
import { deckTitles as titles, seedDeck, slotText, type SeedSlide } from "./seed-deck";
import {
  deckMap,
  elementsOf,
  isDeleted,
  restoreEpochOf,
  slidesMap,
  textOf,
  tombstoneSlide,
} from "~/components/slides/deck/model";
import { addShape, addTextBox, deleteElements, groupElements, moveElements } from "~/components/slides/deck/freeform-ops";
import { setLayout } from "~/components/slides/deck/deck-ops";

const LEGACY: SeedSlide[] = [
  { id: "a", layout: "title", title: "Hello", subtitle: "Sub", notes: "say hi" },
  { id: "b", layout: "content", title: "Agenda", body: [{ type: "paragraph", content: "one two" }] as never },
  { id: "c", layout: "image", title: "Photo", image: { src: "https://x/y.png", alt: "y" } },
];

const seeded = (slides: SeedSlide[] = LEGACY) => {
  const doc = new Y.Doc();
  seedDeck(doc, slides);
  return doc;
};

describe("a live deck", () => {
  it("keeps each slide's text in keyed fragments, with notes and image elements", () => {
    const read = readDeck(seeded());
    expect(deckMap(seeded()).get("v")).toBe(1);
    expect(read.slides.map((s) => [s.id, s.layoutId])).toEqual([["a", "title"], ["b", "content"], ["c", "image"]]);
    expect(read.slides[0].notes.text).toBe("say hi");
    expect(read.slides[1].elements.find((e) => e.slot === "body")!.text).toBe("one two");
    expect(read.slides[2].elements.find((e) => e.slot === "image")).toMatchObject({ src: "https://x/y.png", alt: "y" });
    expect(read.plainText).toContain("Hello");
    expect(read.plainText).toContain("say hi");
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
});

describe("restoreDeck", () => {
  it("replaces the live deck with the snapshot in one transaction and never creates a blocknote share", () => {
    const snapshot = seeded();
    const live = seeded();
    seedDeck(live, [{ id: "extra", layout: "content", title: "Extra" }]);
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

  it("reports a detached slot's geometry and keeps its text", () => {
    const doc = seeded();
    moveElements(doc, "b", ["body"], 10, 10);
    const read = readDeck(doc).slides.find((s) => s.id === "b")!;
    expect(read.elements.find((e) => e.id === "body")).toMatchObject({ slot: "body", x: 170, y: 320 });
    expect(slotText(readDeck(doc), "b", "body")).toBe("one two");
  });
});
