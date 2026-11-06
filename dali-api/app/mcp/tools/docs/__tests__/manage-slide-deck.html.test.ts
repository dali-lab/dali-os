import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { Slide } from "~/components/slides/types";

const env = vi.hoisted(() => ({ doc: null as unknown as Y.Doc, pageUpdate: vi.fn() }));
const decks = vi.hoisted(() => ({
  deckAccess: vi.fn(),
  loadDeck: vi.fn(),
  editDeck: vi.fn(),
  deckStorage: vi.fn(),
  migrateDeckOnOpen: vi.fn(),
  readDeckModel: vi.fn(),
}));
const labDocs = vi.hoisted(() => ({ runCreateLabDocument: vi.fn() }));
const flags = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));

vi.mock("~/lib/slide-decks.server", () => decks);
vi.mock("~/lib/db.server", () => ({ prisma: { page: { update: env.pageUpdate } } }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(async () => ({})) }));
vi.mock("~/lib/feature-flags.server", () => flags);
vi.mock("../lab-documents", () => labDocs);
vi.mock("~/collab/deck-live.server", () => ({
  transactDeck: vi.fn(async (_p: string, _u: string, fn: (d: Y.Doc) => void) => env.doc.transact(() => fn(env.doc))),
}));
vi.mock("~/collab/blocknote-server", async (importOriginal) => importOriginal());

import { runManageSlideDeck, MANAGE_SLIDE_DECK_TOOL_DEF } from "../manage-slide-deck";
import { runCreateSlideDeck, CREATE_SLIDE_DECK_TOOL_DEF } from "../create-slide-deck";
import { seedDeckDoc } from "~/collab/deck-write.server";
import { projectLegacySlides, readDeck } from "~/collab/read-deck.server";
import { elementsOf, slidesMap } from "~/components/slides/deck/model";

const LEGACY: Slide[] = [
  { id: "a", layout: "title", title: "Alpha" },
  { id: "b", layout: "content", title: "Beta" },
];
const PAGE = { id: "p1", title: "Deck", iconEmoji: null };
const read = () => readDeck(env.doc);
const slideRead = (id: string) => read().slides.find((s) => s.id === id)!;
const run = (args: Record<string, unknown>) => runManageSlideDeck("u1", { pageId: "p1", ...args } as never) as Promise<Record<string, any>>;
const BIG = "x".repeat(200_001);

beforeEach(() => {
  vi.clearAllMocks();
  env.doc = new Y.Doc();
  seedDeckDoc(env.doc, LEGACY);
  decks.deckStorage.mockResolvedValue("yjs");
  decks.migrateDeckOnOpen.mockResolvedValue("yjs");
  decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: true });
  decks.loadDeck.mockImplementation(async () => ({ slides: projectLegacySlides(read()), version: "v1", storage: "yjs" }));
  decks.readDeckModel.mockImplementation(async () => read());
  flags.isFeatureEnabled.mockResolvedValue(true);
});

describe("custom HTML through manage_slide_deck", () => {
  const add = (element: Record<string, unknown>) => run({ action: "add_element", slideId: "a", element });

  it("adds an html element with its source as shared text", async () => {
    const out = await add({ kind: "html", html: "<h1>Hi</h1>", x: 100, y: 100, w: 800, h: 400 });
    const el = slideRead("a").elements.find((e) => e.id === out.elementId)!;
    expect(el).toMatchObject({ kind: "html", html: "<h1>Hi</h1>", x: 100, w: 800 });
    const raw = elementsOf(slidesMap(env.doc).get("a")!).get(out.elementId as string)!;
    expect(raw.get("html")).toBeInstanceOf(Y.Text);
  });

  it("adds a fill-slide element at the full stage", async () => {
    const out = await add({ kind: "html", html: "<p>x</p>", htmlFill: true });
    expect(slideRead("a").elements.find((e) => e.id === out.elementId)).toMatchObject({ htmlFill: true, x: 0, y: 0, w: 1920, h: 1080 });
    expect(out.slide.elements.find((e: { id: string }) => e.id === out.elementId)).toMatchObject({ htmlFill: true, w: 1920, h: 1080 });
  });

  it("updates the source and the fill flag, and keeps what is left out", async () => {
    const id = (await add({ kind: "html", html: "<p>one</p>", x: 10, y: 20, w: 300, h: 200 })).elementId;
    await run({ action: "update_element", slideId: "a", elementId: id, element: { html: "<p>two</p>" } });
    expect(slideRead("a").elements.find((e) => e.id === id)).toMatchObject({ html: "<p>two</p>", x: 10, w: 300 });
    await run({ action: "update_element", slideId: "a", elementId: id, element: { htmlFill: true } });
    expect(slideRead("a").elements.find((e) => e.id === id)).toMatchObject({ htmlFill: true, w: 1920 });
    await run({ action: "update_element", slideId: "a", elementId: id, element: { htmlFill: false, x: 50, y: 60, w: 400, h: 300 } });
    const el = slideRead("a").elements.find((e) => e.id === id)!;
    expect(el.htmlFill).toBeUndefined();
    expect(el).toMatchObject({ x: 50, y: 60, w: 400, h: 300 });
  });

  it("strips NUL bytes from the source", async () => {
    const id = (await add({ kind: "html", html: "a\u0000b" })).elementId;
    expect(slideRead("a").elements.find((e) => e.id === id)!.html).toBe("ab");
  });

  it("rejects source over the cap on add and update, writing nothing", async () => {
    await expect(add({ kind: "html", html: BIG })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("200000") });
    const id = (await add({ kind: "html", html: "ok" })).elementId;
    await expect(run({ action: "update_element", slideId: "a", elementId: id, element: { html: BIG } })).rejects.toMatchObject({ status: 400 });
    expect(slideRead("a").elements.find((e) => e.id === id)!.html).toBe("ok");
    expect(slideRead("a").elements.filter((e) => e.kind === "html")).toHaveLength(1);
  });

  it("rejects bad inputs", async () => {
    await expect(add({ kind: "html" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("needs html") });
    await expect(add({ kind: "html", html: 5 })).rejects.toMatchObject({ status: 400 });
    await expect(add({ kind: "html", html: "x", htmlFill: "yes" })).rejects.toMatchObject({ status: 400 });
    await expect(add({ kind: "text", html: "x" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Only html elements") });
    await expect(add({ kind: "text", htmlFill: true })).rejects.toMatchObject({ status: 400 });
    await expect(add({ kind: "script", html: "x" })).rejects.toMatchObject({ status: 400 });
  });

  it("returns a preview and the length by default, and the whole source with includeHtml", async () => {
    const source = `<p>${"y".repeat(1000)}</p>`;
    const id = (await add({ kind: "html", html: source })).elementId;
    const short = (await run({ action: "get", elements: true })).slides[0].elements.find((e: { id: string }) => e.id === id);
    expect(short.htmlLength).toBe(source.length);
    expect(short.htmlPreview).toBe(source.slice(0, 400));
    expect(short).not.toHaveProperty("html");
    const full = (await run({ action: "get", elements: true, includeHtml: true })).slides[0].elements.find((e: { id: string }) => e.id === id);
    expect(full.html).toBe(source);
    expect(full).not.toHaveProperty("htmlPreview");
  });

  it("does not return html unless elements are asked for", async () => {
    await add({ kind: "html", html: "<p>x</p>" });
    expect(JSON.stringify(await run({ action: "get", includeHtml: true }))).not.toContain("<p>x</p>");
  });

  it("refuses a viewer", async () => {
    decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: false });
    await expect(add({ kind: "html", html: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(run({ action: "add_slides", outline: [{ html: "x" }] })).rejects.toMatchObject({ status: 403 });
    expect(read().slides.flatMap((s) => s.elements).some((e) => e.kind === "html")).toBe(false);
  });

  it("still takes every older input", async () => {
    const out = await add({ kind: "shape", shape: "rect", fill: "fg" });
    expect(slideRead("a").elements.find((e) => e.id === out.elementId)).toMatchObject({ kind: "shape" });
    const got = await run({ action: "get", elements: true });
    expect(got.slides[0].elements.find((e: { id: string }) => e.id === "title")).toEqual(expect.objectContaining({ kind: "text" }));
  });

  it("documents the contract in the schema and descriptions", () => {
    const schema = MANAGE_SLIDE_DECK_TOOL_DEF.inputSchema.properties as any;
    expect(schema.element.properties.kind.enum).toContain("html");
    expect(schema.element.properties.html.maxLength).toBe(200_000);
    expect(schema.includeHtml.type).toBe("boolean");
    const text = JSON.stringify(MANAGE_SLIDE_DECK_TOOL_DEF) + JSON.stringify(CREATE_SLIDE_DECK_TOOL_DEF);
    for (const needle of ["1920 by 1080", "--slide-accent", "--slide-font-body", "Network requests", "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "200000", "PowerPoint export turns it into a picture"]) {
      expect(text).toContain(needle);
    }
  });
});

describe("custom HTML in outlines", () => {
  it("add_slides turns an html field into a blank slide with one fill element", async () => {
    const out = await run({ action: "add_slides", outline: [{ html: "<p>page</p>", notes: "n" }, { layoutId: "content", slots: { title: "T" } }] });
    const first = slideRead(out.slideIds[0]);
    expect(first.layoutId).toBe("blank");
    expect(first.elements).toHaveLength(1);
    expect(first.elements[0]).toMatchObject({ kind: "html", html: "<p>page</p>", htmlFill: true, x: 0, y: 0, w: 1920, h: 1080 });
    expect(first.notes.text).toBe("n");
    expect(out.slides[0].elements[0]).toMatchObject({ kind: "html", htmlFill: true });
    expect(slideRead(out.slideIds[1]).layoutId).toBe("content");
  });

  it("keeps other elements on top of the html", async () => {
    const out = await run({ action: "add_slides", outline: [{ html: "<p>bg</p>", elements: [{ kind: "text", markdown: "over" }] }] });
    const els = slideRead(out.slideIds[0]).elements;
    expect(els.map((e) => e.kind)).toEqual(["html", "text"]);
  });

  it("rejects a clashing layout, slots, oversize html and an empty-writes outline", async () => {
    const before = read().slides.length;
    await expect(run({ action: "add_slides", outline: [{ html: "x", layoutId: "content" }] })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Slide 1") });
    await expect(run({ action: "add_slides", outline: [{ html: "x", slots: { title: "t" } }] })).rejects.toMatchObject({ status: 400 });
    await expect(run({ action: "add_slides", outline: [{ layoutId: "blank" }, { html: BIG }] })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Slide 2") });
    expect(read().slides).toHaveLength(before);
  });

  it("accepts blank as the layout", async () => {
    const out = await run({ action: "add_slides", outline: [{ html: "x", layoutId: "blank" }] });
    expect(slideRead(out.slideIds[0]).layoutId).toBe("blank");
  });
});

describe("custom HTML in create_slide_deck", () => {
  beforeEach(() => {
    env.doc = new Y.Doc();
    seedDeckDoc(env.doc, [{ id: "starter", layout: "content", title: "" }]);
    labDocs.runCreateLabDocument.mockResolvedValue({ id: "p1" });
  });

  it("drafts a deck of html slides", async () => {
    const out = await runCreateSlideDeck("u1", { title: "Demo", slides: [{ html: "<h1>One</h1>" }, { html: "<h1>Two</h1>" }] });
    expect(out.slides).toHaveLength(2);
    expect(out.slides[0].elements[0]).toMatchObject({ kind: "html", htmlFill: true, htmlLength: 12 });
    expect(read().slides.map((s) => s.elements[0]?.html)).toEqual(["<h1>One</h1>", "<h1>Two</h1>"]);
  });

  it("writes nothing when one slide is over the cap", async () => {
    await expect(runCreateSlideDeck("u1", { title: "x", slides: [{ html: "ok" }, { html: BIG }] })).rejects.toMatchObject({ status: 400 });
    expect(labDocs.runCreateLabDocument).not.toHaveBeenCalled();
  });
});
