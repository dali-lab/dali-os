import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { Slide } from "~/components/slides/types";

const env = vi.hoisted(() => ({ doc: null as unknown as Y.Doc, pageUpdate: vi.fn(), transact: vi.fn() }));
const decks = vi.hoisted(() => ({
  deckAccess: vi.fn(),
  loadDeck: vi.fn(),
  editDeck: vi.fn(),
  deckStorage: vi.fn(),
  migrateDeckOnOpen: vi.fn(),
  readDeckModel: vi.fn(),
}));

vi.mock("~/lib/slide-decks.server", () => decks);
vi.mock("~/lib/db.server", () => ({ prisma: { page: { update: env.pageUpdate } } }));
vi.mock("~/collab/deck-live.server", () => ({
  transactDeck: env.transact.mockImplementation(async (_p: string, _u: string, fn: (d: Y.Doc) => void) => env.doc.transact(() => fn(env.doc))),
}));
vi.mock("~/collab/blocknote-server", async (importOriginal) => importOriginal());

import { runManageSlideDeck } from "../manage-slide-deck";
import { seedDeckDoc } from "~/collab/deck-write.server";
import { projectLegacySlides, readDeck } from "~/collab/read-deck.server";
import { deckMap, elementsOf, isDeleted, slidesMap } from "~/components/slides/deck/model";
import { addShape, addTextBox, groupElements } from "~/components/slides/deck/freeform-ops";

const LEGACY: Slide[] = [
  { id: "a", layout: "title", title: "Alpha", subtitle: "Sub" },
  { id: "b", layout: "content", title: "Beta" },
];

const PAGE = { id: "p1", title: "Deck", iconEmoji: null };
const read = () => readDeck(env.doc);
const slideRead = (id: string) => read().slides.find((s) => s.id === id)!;
const el = (slideId: string, id: string) => slideRead(slideId).elements.find((e) => e.id === id);
const run = (args: Record<string, unknown>) => runManageSlideDeck("u1", { pageId: "p1", ...args } as never) as Promise<Record<string, any>>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FRONTEND_URL = "https://os.example.edu";
  env.doc = new Y.Doc();
  seedDeckDoc(env.doc, LEGACY);
  decks.deckStorage.mockResolvedValue("yjs");
  decks.migrateDeckOnOpen.mockResolvedValue("yjs");
  decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: true });
  decks.loadDeck.mockImplementation(async () => ({ slides: projectLegacySlides(read()), version: "v1", storage: "yjs" }));
  decks.readDeckModel.mockImplementation(async () => read());
});

describe("get with elements", () => {
  it("adds the theme, room name, layout and elements to the usual output", async () => {
    const out = await run({ action: "get", elements: true });
    expect(out).toMatchObject({ title: "Deck", version: "v1", themeId: "dali-dark", docName: "slides:p1:deck" });
    expect(out.slides[0]).toMatchObject({ id: "a", layout: "title", title: "Alpha", layoutId: "title" });
    const title = out.slides[0].elements.find((e: { id: string }) => e.id === "title");
    expect(title).toEqual({ id: "title", kind: "text", slot: "title", z: 1, markdown: "Alpha", x: 160, y: 300, w: 1600, h: 300, rot: 0 });
  });

  it("leaves the default get exactly as it was", async () => {
    const out = await run({ action: "get" });
    expect(out).not.toHaveProperty("themeId");
    expect(out.slides[0]).not.toHaveProperty("elements");
  });

  it("shows free elements, groups, builds and detached layout boxes", async () => {
    const box = addTextBox(env.doc, "b")!;
    const shape = addShape(env.doc, "b", "ellipse")!;
    const group = groupElements(env.doc, "b", [box, shape])!;
    const title = elementsOf(slidesMap(env.doc).get("b")!).get("title")!;
    title.set("build", 2);
    title.set("x", 10);
    title.set("y", 20);
    title.set("w", 300);
    title.set("h", 100);
    const out = await run({ action: "get", elements: true, limit: 1, cursor: undefined });
    expect(out.slides).toHaveLength(1);
    const next = await run({ action: "get", elements: true, cursor: out.page.nextCursor });
    const els = next.slides[0].elements as Array<Record<string, unknown>>;
    expect(els.find((e) => e.id === "title")).toMatchObject({ build: 2, detached: true, x: 10, y: 20, w: 300, h: 100 });
    expect(els.find((e) => e.id === shape)).toMatchObject({ kind: "shape", shape: "ellipse", fill: "accent", groupId: group, slot: null });
    expect(els.find((e) => e.id === group)).toMatchObject({ kind: "group", children: [box, shape] });
    expect(els.find((e) => e.id === group)).not.toHaveProperty("x");
  });
});

describe("deck and slide actions", () => {
  it("set_theme switches the theme and rejects one that doesn't exist", async () => {
    expect(await run({ action: "set_theme", themeId: "dali-light" })).toMatchObject({ title: "Deck", themeId: "dali-light" });
    expect(deckMap(env.doc).get("themeId")).toBe("dali-light");
    await expect(run({ action: "set_theme", themeId: "neon" })).rejects.toMatchObject({ status: 400 });
    expect(deckMap(env.doc).get("themeId")).toBe("dali-light");
  });

  it("set_layout moves a slide to any layout and fills in its boxes", async () => {
    const out = await run({ action: "set_layout", slideId: "b", layoutId: "bignumber" });
    expect(out.slide).toMatchObject({ id: "b", layoutId: "bignumber" });
    expect(el("b", "subtitle")).toBeDefined();
    await expect(run({ action: "set_layout", slideId: "b", layoutId: "nope" })).rejects.toMatchObject({ status: 400 });
  });

  it("duplicate_slide puts a copy right after the original and returns it", async () => {
    const out = await run({ action: "duplicate_slide", slideId: "a" });
    expect(read().slides.map((s) => s.id)).toEqual(["a", out.slideId, "b"]);
    expect(out.slide.elements.find((e: { id: string }) => e.id === "title").markdown).toBe("Alpha");
  });

  it("add_slide takes a layoutId beyond the legacy four", async () => {
    await run({ action: "add_slide", slide: { title: "Part two" }, layoutId: "section" });
    const added = read().slides[2];
    expect(added.layoutId).toBe("section");
    expect(added.elements.find((e) => e.slot === "title")?.text).toBe("Part two");
    expect(added.elements.some((e) => e.slot === "subtitle")).toBe(true);
  });

  it("add_slide rejects an unknown layoutId before writing", async () => {
    await expect(run({ action: "add_slide", slide: { title: "X" }, layoutId: "poster" })).rejects.toMatchObject({ status: 400 });
    expect(env.transact).not.toHaveBeenCalled();
  });

  it("update_slide keeps free elements a legacy edit knows nothing about", async () => {
    const box = addTextBox(env.doc, "b")!;
    await run({ action: "update_slide", slideId: "b", slide: { title: "Beta 2" } });
    expect(el("b", box)).toBeDefined();
    expect(el("b", "title")?.text).toBe("Beta 2");
  });

  it("export links the PDF, the notes PDF for editors, and the PowerPoint file", async () => {
    expect(await run({ action: "export" })).toEqual({
      title: "Deck",
      pdfUrl: "https://os.example.edu/slides/p1/export.pdf",
      pdfWithNotesUrl: "https://os.example.edu/slides/p1/export.pdf?notes=1",
      pptxUrl: "https://os.example.edu/slides/p1/export.pptx",
    });
    decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: false });
    const viewer = await run({ action: "export" });
    expect(viewer).not.toHaveProperty("pdfWithNotesUrl");
    expect(viewer.pdfUrl).toBe("https://os.example.edu/slides/p1/export.pdf");
  });
});

describe("element actions", () => {
  it("add_element adds a text box with Markdown, a style and a place", async () => {
    const out = await run({
      action: "add_element",
      slideId: "b",
      element: { kind: "text", markdown: "- one\n- two", textStyle: "kicker", x: 100, y: 200, w: 400, h: 120 },
    });
    const added = el("b", out.elementId)!;
    expect(added).toMatchObject({ kind: "text", slot: null, textStyle: "kicker", x: 100, y: 200, w: 400, h: 120 });
    expect(added.blocks.map((b) => b.type)).toEqual(["bulletListItem", "bulletListItem"]);
    expect(out.slide.elements.find((e: { id: string }) => e.id === out.elementId).markdown).toContain("one");
    expect(env.pageUpdate).toHaveBeenCalledWith({ where: { id: "p1" }, data: { lastEditedById: "u1" } });
  });

  it("add_element adds shapes and images", async () => {
    const shape = await run({ action: "add_element", slideId: "b", element: { kind: "shape", shape: "arrow", fill: "muted" } });
    expect(el("b", shape.elementId)).toMatchObject({ kind: "shape", shape: "arrow", fill: "muted" });
    const image = await run({ action: "add_element", slideId: "b", element: { kind: "image", src: "/uploads/a.png", alt: "Chart" } });
    expect(el("b", image.elementId)).toMatchObject({ kind: "image", src: "/uploads/a.png", alt: "Chart" });
  });

  it("add_element refuses a shape with no kind, an image with no or a bad src, and a too-small size, adding nothing", async () => {
    const before = slideRead("b").elements.length;
    await expect(run({ action: "add_element", slideId: "b", element: { kind: "shape" } })).rejects.toMatchObject({ status: 400 });
    await expect(run({ action: "add_element", slideId: "b", element: { kind: "image" } })).rejects.toMatchObject({ status: 400 });
    await expect(run({ action: "add_element", slideId: "b", element: { kind: "image", src: "javascript:alert(1)" } })).rejects.toMatchObject({ status: 400 });
    await expect(run({ action: "add_element", slideId: "b", element: { kind: "image", src: "//evil.example/x.png" } })).rejects.toMatchObject({ status: 400 });
    await expect(run({ action: "add_element", slideId: "b", element: { kind: "text", w: 2 } })).rejects.toMatchObject({ status: 400 });
    await expect(run({ action: "add_element", slideId: "b", element: { kind: "text", shape: "rect" } })).rejects.toMatchObject({ status: 400 });
    await expect(run({ action: "add_element", slideId: "b", element: { markdown: "x" } })).rejects.toMatchObject({ status: 400 });
    await expect(run({ action: "add_element", slideId: "b", element: { kind: "shape", shape: "star" } })).rejects.toMatchObject({ status: 400 });
    await expect(run({ action: "add_element", slideId: "b", element: { kind: "shape", shape: "rect", fill: "purple" } })).rejects.toMatchObject({ status: 400 });
    await expect(run({ action: "add_element", slideId: "b", element: { kind: "text", textStyle: "huge" } })).rejects.toMatchObject({ status: 400 });
    expect(slideRead("b").elements).toHaveLength(before);
  });

  it("update_element rewrites a layout box's text and style, and 'default' clears the style", async () => {
    await run({ action: "update_element", slideId: "b", elementId: "body", element: { markdown: "New body", textStyle: "heading" } });
    expect(el("b", "body")).toMatchObject({ text: "New body", textStyle: "heading" });
    await run({ action: "update_element", slideId: "b", elementId: "body", element: { textStyle: "default" } });
    expect(el("b", "body")).toMatchObject({ text: "New body", textStyle: null });
    await run({ action: "update_element", slideId: "b", elementId: "body", element: { markdown: "" } });
    expect(el("b", "body")?.text).toBe("");
  });

  it("update_element moves a layout box off its slot, keeping the fields not given", async () => {
    await run({ action: "update_element", slideId: "b", elementId: "title", element: { x: 400, rot: 15 } });
    expect(el("b", "title")).toMatchObject({ x: 400, y: 110, w: 1600, h: 150, rot: 15 });
  });

  it("update_element sets and clears builds", async () => {
    await run({ action: "update_element", slideId: "b", elementId: "body", element: { build: 2, buildBullets: true } });
    expect(el("b", "body")).toMatchObject({ build: 2, buildBullets: true });
    await run({ action: "update_element", slideId: "b", elementId: "body", element: { build: 0, buildBullets: false } });
    expect(el("b", "body")).not.toHaveProperty("build");
    expect(el("b", "body")).not.toHaveProperty("buildBullets");
  });

  it("update_element changes an image slot's picture and a shape's fill", async () => {
    await run({ action: "set_layout", slideId: "b", layoutId: "split" });
    await run({ action: "update_element", slideId: "b", elementId: "image", element: { src: "https://img.example/p.png", alt: "P" } });
    expect(el("b", "image")).toMatchObject({ src: "https://img.example/p.png", alt: "P" });
    const shape = addShape(env.doc, "b", "rect")!;
    await run({ action: "update_element", slideId: "b", elementId: shape, element: { fill: "rule" } });
    expect(el("b", shape)?.fill).toBe("rule");
  });

  it("update_element refuses fields that don't fit the element and writes none of them", async () => {
    const shape = addShape(env.doc, "b", "rect")!;
    for (const element of [{ markdown: "x", fill: "fg" }, { src: "/a.png" }, { textStyle: "body" }, { kind: "text" }, { shape: "ellipse" }, { w: 1 }]) {
      await expect(run({ action: "update_element", slideId: "b", elementId: shape, element })).rejects.toMatchObject({ status: 400 });
    }
    expect(el("b", shape)).toMatchObject({ fill: "accent", shape: "rect", w: 480 });
    await expect(run({ action: "update_element", slideId: "b", elementId: "title", element: { fill: "fg" } })).rejects.toMatchObject({ status: 400 });
  });

  it("update_element refuses to place a group", async () => {
    const g = groupElements(env.doc, "b", [addTextBox(env.doc, "b")!, addTextBox(env.doc, "b")!])!;
    await expect(run({ action: "update_element", slideId: "b", elementId: g, element: { x: 5 } })).rejects.toMatchObject({ status: 400 });
  });

  it("delete_elements removes free elements and only empties layout boxes", async () => {
    const box = addTextBox(env.doc, "b")!;
    const out = await run({ action: "delete_elements", slideId: "b", elementIds: [box, "title"] });
    expect(out.removed).toEqual([box]);
    expect(isDeleted(elementsOf(slidesMap(env.doc).get("b")!).get(box)!)).toBe(true);
    expect(el("b", "title")).toBeDefined();
  });

  it("duplicate_elements copies next to the originals", async () => {
    const shape = addShape(env.doc, "b", "rect")!;
    const out = await run({ action: "duplicate_elements", slideId: "b", elementIds: [shape] });
    const [copy] = out.elementIds;
    expect(el("b", copy)).toMatchObject({ kind: "shape", x: el("b", shape)!.x! + 24 });
  });

  it("reorder_elements brings an element to the front", async () => {
    const shape = addShape(env.doc, "b", "rect")!;
    await run({ action: "reorder_elements", slideId: "b", elementIds: ["title"], direction: "front" });
    expect(el("b", "title")!.z).toBeGreaterThan(el("b", shape)!.z);
    await expect(run({ action: "reorder_elements", slideId: "b", elementIds: ["title"], direction: "up" })).rejects.toMatchObject({ status: 400 });
  });

  it("group_elements and ungroup_elements", async () => {
    const one = addTextBox(env.doc, "b")!;
    const two = addShape(env.doc, "b", "rect")!;
    const grouped = await run({ action: "group_elements", slideId: "b", elementIds: [one, two] });
    expect(el("b", grouped.groupId)).toMatchObject({ kind: "group", children: [one, two] });
    await expect(run({ action: "group_elements", slideId: "b", elementIds: [one] })).rejects.toMatchObject({ status: 400 });
    const ungrouped = await run({ action: "ungroup_elements", slideId: "b", elementIds: [grouped.groupId] });
    expect(ungrouped.elementIds).toEqual([one, two]);
    expect(el("b", grouped.groupId)).toBeUndefined();
  });

  it("align_elements lines one element up with the slide, and several with each other", async () => {
    const shape = addShape(env.doc, "b", "rect")!;
    await run({ action: "align_elements", slideId: "b", elementIds: [shape], align: "left" });
    expect(el("b", shape)!.x).toBe(0);
    const other = addShape(env.doc, "b", "rect")!;
    await run({ action: "update_element", slideId: "b", elementId: other, element: { x: 300 } });
    await run({ action: "align_elements", slideId: "b", elementIds: [shape, other], align: "right" });
    expect(el("b", shape)!.x).toBe(300);
    await expect(run({ action: "align_elements", slideId: "b", elementIds: [shape], align: "left", relativeTo: "selection" })).rejects.toMatchObject({ status: 400 });
  });

  it("distribute_elements needs three and spaces them evenly", async () => {
    const ids = [0, 600, 1400].map((x) => {
      const id = addShape(env.doc, "b", "rect")!;
      elementsOf(slidesMap(env.doc).get("b")!).get(id)!.set("x", x);
      return id;
    });
    await expect(run({ action: "distribute_elements", slideId: "b", elementIds: ids.slice(0, 2), axis: "x" })).rejects.toMatchObject({ status: 400 });
    await run({ action: "distribute_elements", slideId: "b", elementIds: ids, axis: "x" });
    const xs = ids.map((id) => el("b", id)!.x!);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1]);
  });

  it("snap_back returns a moved layout box to its slot", async () => {
    await run({ action: "update_element", slideId: "b", elementId: "title", element: { x: 5 } });
    await run({ action: "snap_back", slideId: "b", elementIds: ["title"] });
    expect(el("b", "title")).not.toHaveProperty("x");
  });

  it("answers 404 for a missing or deleted slide and a missing element", async () => {
    await expect(run({ action: "set_layout", slideId: "zz", layoutId: "blank" })).rejects.toMatchObject({ status: 404 });
    slidesMap(env.doc).get("a")!.set("deleted", true);
    await expect(run({ action: "duplicate_slide", slideId: "a" })).rejects.toMatchObject({ status: 404 });
    await expect(run({ action: "update_element", slideId: "b", elementId: "nope", element: { x: 1 } })).rejects.toMatchObject({ status: 404 });
    await expect(run({ action: "delete_elements", slideId: "b", elementIds: ["title", "nope"] })).rejects.toMatchObject({ status: 404 });
    expect(el("b", "title")).toBeDefined();
  });

  it("names the missing argument", async () => {
    await expect(run({ action: "add_element", slideId: "b" })).rejects.toThrow(/element/);
    await expect(run({ action: "reorder_elements", slideId: "b", elementIds: ["title"] })).rejects.toThrow(/direction/);
  });
});

describe("access and storage", () => {
  it("refuses every live-model edit from a viewer", async () => {
    decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: false });
    await expect(run({ action: "set_theme", themeId: "dali-light" })).rejects.toMatchObject({ status: 403 });
    await expect(run({ action: "add_element", slideId: "b", element: { kind: "text" } })).rejects.toMatchObject({ status: 403 });
    await expect(run({ action: "add_slide", slide: { title: "X" }, layoutId: "blank" })).rejects.toMatchObject({ status: 403 });
    expect(env.transact).not.toHaveBeenCalled();
    expect(decks.migrateDeckOnOpen).not.toHaveBeenCalled();
  });

  it("a viewer can read elements", async () => {
    decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: false });
    await expect(run({ action: "get", elements: true })).resolves.toMatchObject({ themeId: "dali-dark" });
  });

  it("moves a JSON deck to live storage first, and refuses when that isn't on for the caller", async () => {
    await run({ action: "set_theme", themeId: "dali-light" });
    expect(decks.migrateDeckOnOpen).toHaveBeenCalledWith("u1", "p1");
    decks.migrateDeckOnOpen.mockResolvedValue("json");
    await expect(run({ action: "set_theme", themeId: "dali-dark" })).rejects.toMatchObject({ status: 400 });
    await expect(run({ action: "add_slide", slide: { title: "X" }, layoutId: "blank" })).rejects.toMatchObject({ status: 400 });
    expect(env.transact).toHaveBeenCalledTimes(1);
  });
});
