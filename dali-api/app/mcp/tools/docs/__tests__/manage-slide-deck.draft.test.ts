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

import { runManageSlideDeck } from "../manage-slide-deck";
import type { OutlineSlide } from "../slide-outline";
import { runCreateSlideDeck, CREATE_SLIDE_DECK_TOOL_DEF } from "../create-slide-deck";
import { seedDeckDoc } from "~/collab/deck-write.server";
import { projectLegacySlides, readDeck } from "~/collab/read-deck.server";
import { richDocToMarkdown } from "~/components/slides/slide-markdown.server";

const LEGACY: Slide[] = [
  { id: "a", layout: "title", title: "Alpha" },
  { id: "b", layout: "content", title: "Beta" },
];
const PAGE = { id: "p1", title: "Deck", iconEmoji: null };
const read = () => readDeck(env.doc);
const slideRead = (id: string) => read().slides.find((s) => s.id === id)!;
const run = (args: Record<string, unknown>) => runManageSlideDeck("u1", { pageId: "p1", ...args } as never) as Promise<Record<string, any>>;
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

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

describe("add_element with every kind", () => {
  const add = (element: Record<string, unknown>) => run({ action: "add_element", slideId: "a", element });

  it("adds a chart with its data, and reads it back with the element id", async () => {
    const out = await add({ kind: "chart", chart: { type: "bar", labels: ["Q1", "Q2"], series: [{ name: "Sales", values: [3, 5] }] }, x: 100, y: 100, w: 800, h: 400 });
    const id = out.elementId as string;
    const el = slideRead("a").elements.find((e) => e.id === id)!;
    expect(el).toMatchObject({ kind: "chart", x: 100, w: 800 });
    expect(el.chart).toEqual({ type: "bar", data: { labels: ["Q1", "Q2"], series: [{ name: "Sales", values: [3, 5] }] } });
    expect(out.slide.elements.find((e: { id: string }) => e.id === id).chart).toEqual({ type: "bar", labels: ["Q1", "Q2"], series: [{ name: "Sales", values: [3, 5] }] });
    const got = await run({ action: "get", elements: true });
    expect(got.slides[0].elements.find((e: { id: string }) => e.id === id).kind).toBe("chart");
  });

  it("adds an icon, a video and a poll", async () => {
    const icon = (await add({ kind: "icon", icon: "rocket", fill: "fg" })).elementId;
    const video = (await add({ kind: "video", videoUrl: YT })).elementId;
    const poll = (await add({ kind: "poll", poll: { question: "Ship it?", options: ["Yes", "No"], multi: true } })).elementId;
    const els = slideRead("a").elements;
    expect(els.find((e) => e.id === icon)).toMatchObject({ kind: "icon", icon: "rocket", fill: "fg" });
    expect(els.find((e) => e.id === video)).toMatchObject({ kind: "video", videoUrl: YT });
    expect(els.find((e) => e.id === poll)!.poll).toEqual({ question: "Ship it?", options: ["Yes", "No"], multi: true });
  });

  it("adds a table and a code block inside a text element's markdown", async () => {
    const out = await add({ kind: "text", markdown: "| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```" });
    const el = slideRead("a").elements.find((e) => e.id === out.elementId)!;
    const types = (el.blocks as Array<{ type: string }>).map((b) => b.type);
    expect(types).toContain("table");
    expect(types).toContain("codeBlock");
  });

  it("updates a chart, an icon, a video and a poll in place", async () => {
    const chart = (await add({ kind: "chart", chart: { type: "bar", labels: ["A"], series: [{ name: "S", values: [1] }] } })).elementId;
    const poll = (await add({ kind: "poll", poll: { question: "Q?", options: ["a", "b"] } })).elementId;
    const icon = (await add({ kind: "icon", icon: "rocket" })).elementId;
    const video = (await add({ kind: "video", videoUrl: YT })).elementId;
    await run({ action: "update_element", slideId: "a", elementId: chart, element: { chart: { type: "pie", labels: ["X", "Y"], series: [{ name: "S", values: [2, 3] }] } } });
    await run({ action: "update_element", slideId: "a", elementId: poll, element: { poll: { question: "New?", options: ["c", "d", "e"] } } });
    await run({ action: "update_element", slideId: "a", elementId: icon, element: { icon: "star" } });
    await run({ action: "update_element", slideId: "a", elementId: video, element: { videoUrl: "https://youtu.be/dQw4w9WgXcQ" } });
    const els = slideRead("a").elements;
    expect(els.find((e) => e.id === chart)!.chart!.type).toBe("pie");
    expect(els.find((e) => e.id === poll)!.poll!.options).toEqual(["c", "d", "e"]);
    expect(els.find((e) => e.id === icon)!.icon).toBe("star");
    expect(els.find((e) => e.id === video)!.videoUrl).toBe("https://youtu.be/dQw4w9WgXcQ");
  });

  it.each([
    ["a chart with no data", { kind: "chart" }],
    ["a chart whose series is too short to be valid", { kind: "chart", chart: { type: "bar", labels: [], series: [] } }],
    ["a chart with a type that does not exist", { kind: "chart", chart: { type: "radar", labels: ["a"], series: [{ name: "s", values: [1] }] } }],
    ["an icon that does not exist", { kind: "icon", icon: "not-an-icon" }],
    ["an icon with no name", { kind: "icon" }],
    ["a video that is not YouTube", { kind: "video", videoUrl: "https://example.com/v.mp4" }],
    ["a poll with one option", { kind: "poll", poll: { question: "q", options: ["only"] } }],
    ["a poll with seven options", { kind: "poll", poll: { question: "q", options: ["1", "2", "3", "4", "5", "6", "7"] } }],
    ["chart data on a text element", { kind: "text", chart: { type: "bar", labels: ["a"], series: [{ name: "s", values: [1] }] } }],
    ["a poll on a shape", { kind: "shape", shape: "rect", poll: { question: "q", options: ["a", "b"] } }],
  ])("rejects %s without writing anything", async (_name, element) => {
    const before = slideRead("a").elements.length;
    await expect(add(element)).rejects.toMatchObject({ status: 400 });
    expect(slideRead("a").elements).toHaveLength(before);
  });

  it("keeps the old inputs valid: text, image and shape", async () => {
    await expect(add({ kind: "text", markdown: "Hello" })).resolves.toBeTruthy();
    await expect(add({ kind: "image", src: "https://x/y.png", alt: "y" })).resolves.toBeTruthy();
    await expect(add({ kind: "shape", shape: "ellipse", fill: "accent" })).resolves.toBeTruthy();
  });

  it("is refused for someone who can only view", async () => {
    decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: false });
    await expect(add({ kind: "poll", poll: { question: "q", options: ["a", "b"] } })).rejects.toMatchObject({ status: 403 });
  });
});

describe("add_slides", () => {
  const outline = [
    {
      layoutId: "content",
      slots: { title: "Plan", body: "- one\n- two" },
      notes: "Say hello",
      elements: [{ kind: "poll", poll: { question: "Ready?", options: ["Yes", "No"] } }],
    },
    { layoutId: "title", slots: { title: "Thanks" } },
  ];

  it("appends the slides in order with text, notes and elements, and returns their element ids", async () => {
    const out = await run({ action: "add_slides", outline });
    expect(out.slideIds).toHaveLength(2);
    expect(read().slides.map((s) => s.id)).toEqual(["a", "b", ...out.slideIds]);
    const first = slideRead(out.slideIds[0]);
    expect(first.layoutId).toBe("content");
    expect(await richDocToMarkdown(first.elements.find((e) => e.id === "title")!.blocks as never)).toBe("Plan");
    expect(await richDocToMarkdown(first.elements.find((e) => e.id === "body")!.blocks as never)).toContain("one");
    expect(first.elements.find((e) => e.kind === "poll")!.poll).toEqual({ question: "Ready?", options: ["Yes", "No"] });
    expect(first.notes.text).toContain("Say hello");
    expect(out.slides[0].elements.some((e: { kind: string }) => e.kind === "poll")).toBe(true);
  });

  it("inserts at an index, including the very start", async () => {
    const mid = await run({ action: "add_slides", index: 1, outline: [{ slots: { title: "Middle" } }] });
    expect(read().slides.map((s) => s.id)).toEqual(["a", mid.slideIds[0], "b"]);
    const start = await run({ action: "add_slides", index: 0, outline: [{ slots: { title: "First" } }] });
    expect(read().slides[0].id).toBe(start.slideIds[0]);
  });

  it("sets an image box from a URL", async () => {
    const out = await run({ action: "add_slides", outline: [{ layoutId: "image", slots: { image: { src: "https://x/y.png", alt: "y" } } }] });
    expect(slideRead(out.slideIds[0]).elements.find((e) => e.slot === "image")).toMatchObject({ src: "https://x/y.png", alt: "y" });
  });

  it.each([
    ["an unknown layout", [{ layoutId: "nope" }]],
    ["a box the layout lacks", [{ layoutId: "title", slots: { sidebar: "x" } }]],
    ["text in an image box", [{ layoutId: "image", slots: { image: "text" } }]],
    ["an image box without a source", [{ layoutId: "image", slots: { image: { alt: "y" } } }]],
    ["an unsafe image address", [{ layoutId: "image", slots: { image: { src: "javascript:alert(1)" } } }]],
    ["an invalid element on a later slide", [{ slots: { title: "ok" } }, { elements: [{ kind: "icon", icon: "nope" }] }]],
    ["no slides", []],
  ])("rejects %s and writes nothing", async (_name, bad) => {
    await expect(run({ action: "add_slides", outline: bad })).rejects.toMatchObject({ status: 400 });
    expect(read().slides.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("is refused for a viewer and for a deck on the older editor", async () => {
    decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: false });
    await expect(run({ action: "add_slides", outline })).rejects.toMatchObject({ status: 403 });
    decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: true });
    decks.migrateDeckOnOpen.mockResolvedValue("json");
    await expect(run({ action: "add_slides", outline })).rejects.toMatchObject({ status: 400 });
    expect(read().slides).toHaveLength(2);
  });

  it("needs an outline", async () => {
    await expect(run({ action: "add_slides" })).rejects.toBeTruthy();
  });

  it("leaves the existing slide actions alone", async () => {
    const out = await run({ action: "add_slide", slide: { title: "Old way", layout: "content" } });
    expect(out.slides).toHaveLength(3);
  });
});

describe("create_slide_deck", () => {
  beforeEach(() => {
    env.doc = new Y.Doc();
    seedDeckDoc(env.doc, [{ id: "starter", layout: "content", title: "" }]);
    labDocs.runCreateLabDocument.mockResolvedValue({ id: "p1" });
  });

  const slides: OutlineSlide[] = [
    { layoutId: "title", slots: { title: "Launch", subtitle: "Q4" } },
    { layoutId: "content", slots: { title: "Plan", body: "- one" }, elements: [{ kind: "chart", chart: { type: "line", labels: ["a", "b"], series: [{ name: "s", values: [1, 2] }] } }] },
  ];

  it("creates a lab Slides page, sets the theme, replaces the starter slide and returns every element id", async () => {
    const out = await runCreateSlideDeck("u1", { title: "Launch", themeId: "dali-light", parentPageId: "folder1", slides });
    expect(labDocs.runCreateLabDocument).toHaveBeenCalledWith("u1", { title: "Launch", kind: "Slides", parentPageId: "folder1" });
    expect(out).toMatchObject({ pageId: "p1", themeId: "dali-light" });
    expect(read().slides.map((s) => s.layoutId)).toEqual(["title", "content"]);
    expect(read().slides.map((s) => s.id)).toEqual(out.slides.map((s) => s.id));
    expect(out.slides[1].elements.find((e) => e.kind === "chart")).toBeTruthy();
    expect(env.pageUpdate).toHaveBeenCalledWith({ where: { id: "p1" }, data: { lastEditedById: "u1" } });
  });

  it("checks the outline before creating a page", async () => {
    await expect(runCreateSlideDeck("u1", { title: "x", slides: [{ layoutId: "nope" }] })).rejects.toMatchObject({ status: 400 });
    await expect(runCreateSlideDeck("u1", { title: "x", themeId: "nope", slides })).rejects.toMatchObject({ status: 400 });
    expect(labDocs.runCreateLabDocument).not.toHaveBeenCalled();
  });

  it("does not create a page when the live deck editor is off for the caller", async () => {
    flags.isFeatureEnabled.mockResolvedValue(false);
    await expect(runCreateSlideDeck("u1", { title: "x", slides })).rejects.toMatchObject({ status: 400 });
    expect(labDocs.runCreateLabDocument).not.toHaveBeenCalled();
  });

  it("passes on the lab document tool's refusal for a non-member", async () => {
    labDocs.runCreateLabDocument.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(runCreateSlideDeck("u1", { title: "x", slides })).rejects.toMatchObject({ status: 403 });
  });

  it("is a write tool with a documented schema", () => {
    expect(CREATE_SLIDE_DECK_TOOL_DEF.requiredScope).toBe("mcp:write");
    expect(CREATE_SLIDE_DECK_TOOL_DEF.inputSchema.required).toEqual(["title", "slides"]);
    expect(CREATE_SLIDE_DECK_TOOL_DEF.description).not.toMatch(/Ask DALI/);
  });
});
