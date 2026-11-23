import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const env = vi.hoisted(() => ({ doc: null as unknown as Y.Doc, pageUpdate: vi.fn(), transact: vi.fn() }));
const decks = vi.hoisted(() => ({ deckAccess: vi.fn(), readDeckModel: vi.fn() }));
const presence = vi.hoisted(() => ({ announceAgent: vi.fn(), pagePresenceRoom: (id: string) => `presence:doc:${id}` }));

vi.mock("~/lib/slide-decks.server", () => decks);
vi.mock("~/lib/db.server", () => ({ prisma: { page: { update: env.pageUpdate } } }));
vi.mock("~/collab/deck-live.server", () => ({
  transactDeck: env.transact.mockImplementation(async (_p: string, _u: string, fn: (d: Y.Doc) => void) => env.doc.transact(() => fn(env.doc))),
}));
vi.mock("~/collab/agent-presence.server", () => presence);
vi.mock("~/collab/blocknote-server", async (importOriginal) => importOriginal());

import {
  GET_SLIDE_DECK_TOOL_DEF,
  MANAGE_SLIDE_DECK_TOOL_DEF,
  MANAGE_SLIDE_ELEMENTS_TOOL_DEF,
  runGetSlideDeck,
  runManageSlideDeck,
} from "../manage-slide-deck";
import { seedDeck, type SeedSlide } from "~/collab/__tests__/seed-deck";
import { readDeck } from "~/collab/read-deck.server";
import { elementsOf, isDeleted, slidesMap } from "~/components/slides/deck/model";
import { addTextBox } from "~/components/slides/deck/freeform-ops";

const SEED: SeedSlide[] = [
  { id: "a", layout: "title", title: "Alpha", subtitle: "Sub", notes: "keep me" },
  { id: "b", layout: "content", title: "Beta", body: [{ type: "paragraph", content: "one" }] as never },
  { id: "c", layout: "image", title: "Gamma", image: { src: "https://x/y.png", alt: "y" } },
];
const PAGE = { id: "p1", title: "Deck", iconEmoji: null };
const read = () => readDeck(env.doc);
const slide = (id: string) => read().slides.find((s) => s.id === id)!;
const slot = (id: string, name: string) => slide(id).elements.find((e) => e.slot === name);
const ids = () => read().slides.map((s) => s.id);
const run = (args: Record<string, unknown>) => runManageSlideDeck("u1", { pageId: "p1", ...args } as never) as Promise<Record<string, any>>;

beforeEach(() => {
  vi.clearAllMocks();
  env.doc = new Y.Doc();
  seedDeck(env.doc, SEED);
  decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: true });
  decks.readDeckModel.mockImplementation(async () => read());
});

describe("slide deck tool split", () => {
  const actionsOf = (def: { inputSchema: { properties: Record<string, unknown> } }) =>
    (def.inputSchema.properties.action as { enum: string[] } | undefined)?.enum ?? [];

  it("reads with mcp:read and writes with mcp:write", () => {
    expect(GET_SLIDE_DECK_TOOL_DEF.requiredScope).toBe("mcp:read");
    expect(MANAGE_SLIDE_DECK_TOOL_DEF.requiredScope).toBe("mcp:write");
    expect(MANAGE_SLIDE_ELEMENTS_TOOL_DEF.requiredScope).toBe("mcp:write");
  });

  it("gives the read tool no action, and keeps get and export out of the write tools", () => {
    expect(GET_SLIDE_DECK_TOOL_DEF.inputSchema.properties).not.toHaveProperty("action");
    for (const def of [MANAGE_SLIDE_DECK_TOOL_DEF, MANAGE_SLIDE_ELEMENTS_TOOL_DEF]) {
      expect(actionsOf(def)).not.toContain("get");
      expect(actionsOf(def)).not.toContain("export");
    }
  });

  it("splits slide actions from element actions with no overlap", () => {
    const slides = actionsOf(MANAGE_SLIDE_DECK_TOOL_DEF);
    const elements = actionsOf(MANAGE_SLIDE_ELEMENTS_TOOL_DEF);
    expect(slides).toEqual(["create", "set_slides", "add_slides", "update_slide", "delete_slide", "move_slide", "duplicate_slide", "set_layout", "set_theme"]);
    expect(elements.every((a) => a.endsWith("_element") || a.endsWith("_elements") || a === "snap_back")).toBe(true);
    expect(slides.filter((a) => elements.includes(a))).toEqual([]);
    expect(MANAGE_SLIDE_DECK_TOOL_DEF.inputSchema.properties).not.toHaveProperty("element");
    expect(MANAGE_SLIDE_ELEMENTS_TOOL_DEF.inputSchema.required).toEqual(["action", "pageId", "slideId"]);
  });

  it("takes slides only as outline slides: the four-layout inputs are gone", () => {
    const props = MANAGE_SLIDE_DECK_TOOL_DEF.inputSchema.properties as Record<string, any>;
    expect(props).not.toHaveProperty("slides");
    expect(props.slide.properties).toHaveProperty("layoutId");
    expect(props.slide.properties).not.toHaveProperty("bodyMarkdown");
    expect(props.slide.properties).not.toHaveProperty("layout");
    expect(props.outline.items.properties).toHaveProperty("slots");
  });

  it("get_slide_deck reads the slides without writing", async () => {
    const out = await runGetSlideDeck("u1", { pageId: "p1", limit: 2 });
    expect(out).toMatchObject({ title: "Deck", slides: [{ id: "a" }, { id: "b" }], page: { hasMore: true } });
    expect(env.transact).not.toHaveBeenCalled();
  });

  it("get_slide_deck returns download links instead when exportLinks is set", async () => {
    const out = (await runGetSlideDeck("u1", { pageId: "p1", exportLinks: true })) as Record<string, unknown>;
    expect(out.title).toBe("Deck");
    expect(out).not.toHaveProperty("slides");
    expect(env.transact).not.toHaveBeenCalled();
  });

  it("get_slide_deck still checks access", async () => {
    decks.deckAccess.mockResolvedValue({ ok: false, error: "Not found", status: 404 });
    await expect(runGetSlideDeck("u1", { pageId: "p1" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("manage_slide_deck get", () => {
  it("returns each slide's layout, box text as Markdown, image boxes and notes", async () => {
    const out = await run({ action: "get" });
    expect(out).toMatchObject({ title: "Deck", themeId: "dali-dark", page: { nextCursor: null, hasMore: false, limit: 50, total: 3 } });
    expect(out.slides).toEqual([
      { id: "a", layoutId: "title", slots: { title: "Alpha", subtitle: "Sub" }, notes: "keep me" },
      { id: "b", layoutId: "content", slots: { title: "Beta", body: "one" } },
      { id: "c", layoutId: "image", slots: { title: "Gamma", image: { src: "https://x/y.png", alt: "y" } } },
    ]);
  });

  it("reads a deck with no slides, such as one just created or never opened, as empty", async () => {
    env.doc = new Y.Doc();
    expect(await run({ action: "get" })).toMatchObject({ slides: [], page: { total: 0 } });
  });

  it("pages the slides in order and the last page has no cursor", async () => {
    const first = await run({ action: "get", limit: 2 });
    expect(first).toMatchObject({ slides: [{ id: "a" }, { id: "b" }], page: { hasMore: true, limit: 2, total: 3 } });
    const second = await run({ action: "get", limit: 2, cursor: first.page.nextCursor });
    expect(second).toMatchObject({ slides: [{ id: "c" }], page: { nextCursor: null, hasMore: false } });
  });

  it("leaves out tombstoned slides", async () => {
    await run({ action: "delete_slide", slideId: "b" });
    expect((await run({ action: "get" })).slides.map((s: { id: string }) => s.id)).toEqual(["a", "c"]);
  });

  it("shows the agent reading the deck for get and export", async () => {
    await run({ action: "get" });
    await run({ action: "export" });
    expect(presence.announceAgent.mock.calls).toEqual([
      [{ action: "reading", presenceRoom: "presence:doc:p1" }],
      [{ action: "reading", presenceRoom: "presence:doc:p1" }],
    ]);
  });

  it("lets a viewer read", async () => {
    decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: false });
    await expect(run({ action: "get" })).resolves.toMatchObject({ title: "Deck" });
  });
});

describe("manage_slide_deck set_slides", () => {
  const outline = [
    { layoutId: "title", slots: { title: "New", subtitle: "Fresh" }, notes: "say it" },
    { layoutId: "content", slots: { title: "Two", body: "- one\n- two" } },
  ];

  it("replaces every slide with the outline and tombstones what it drops", async () => {
    const out = await run({ action: "set_slides", outline });
    expect(read().slides.map((s) => slot(s.id, "title")?.text)).toEqual(["New", "Two"]);
    expect(slot(read().slides[0].id, "subtitle")?.text).toBe("Fresh");
    expect(read().slides[0].notes.text).toBe("say it");
    for (const id of ["a", "b", "c"]) expect(isDeleted(slidesMap(env.doc).get(id)!)).toBe(true);
    expect(out.slides.map((s: { slots: { title: string } }) => s.slots.title)).toEqual(["New", "Two"]);
    expect(out).toMatchObject({ title: "Deck" });
    expect(env.pageUpdate).toHaveBeenCalledWith({ where: { id: "p1" }, data: { lastEditedById: "u1" } });
  });

  it("writes nothing when any outline slide is invalid", async () => {
    await expect(run({ action: "set_slides", outline: [outline[0], { layoutId: "nope" }] })).rejects.toMatchObject({ status: 400 });
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(env.transact).not.toHaveBeenCalled();
  });

  it("needs an outline, and the four-layout slides input is not accepted", async () => {
    await expect(run({ action: "set_slides" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("outline") });
    await expect(run({ action: "set_slides", slides: [{ title: "x" }] })).rejects.toMatchObject({ status: 400 });
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("is refused for a viewer", async () => {
    decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: false });
    await expect(run({ action: "set_slides", outline })).rejects.toMatchObject({ status: 403 });
    expect(env.transact).not.toHaveBeenCalled();
  });
});

describe("manage_slide_deck update_slide", () => {
  it("changes the boxes it is given and keeps the other boxes, the layout and the notes", async () => {
    const out = await run({ action: "update_slide", slideId: "a", slide: { slots: { title: "Alpha 2" } } });
    expect(slot("a", "title")?.text).toBe("Alpha 2");
    expect(slot("a", "subtitle")?.text).toBe("Sub");
    expect(slide("a").layoutId).toBe("title");
    expect(slide("a").notes.text).toBe("keep me");
    expect(out.slides.map((s: { id: string }) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("edits the speaker notes, and clears them with an empty string", async () => {
    await run({ action: "update_slide", slideId: "a", slide: { notes: "new words" } });
    expect(slide("a").notes.text).toBe("new words");
    expect(slot("a", "title")?.text).toBe("Alpha");
    await run({ action: "update_slide", slideId: "a", slide: { notes: "" } });
    expect(slide("a").notes.text).toBe("");
  });

  it("clears a box with an empty string and sets an image box", async () => {
    await run({ action: "update_slide", slideId: "c", slide: { slots: { title: "", image: { src: "https://x/z.png", alt: "z" } } } });
    expect(slot("c", "title")?.text).toBe("");
    expect(slot("c", "image")).toMatchObject({ src: "https://x/z.png", alt: "z" });
  });

  it("changes the layout and checks the boxes against the new one", async () => {
    await run({ action: "update_slide", slideId: "b", slide: { layoutId: "section" } });
    expect(slide("b").layoutId).toBe("section");
    expect(slot("b", "title")?.text).toBe("Beta");
    await expect(run({ action: "update_slide", slideId: "b", slide: { slots: { nope: "x" } } })).rejects.toMatchObject({ status: 400 });
  });

  it("keeps free elements and adds the ones it is given", async () => {
    const box = addTextBox(env.doc, "b")!;
    await run({ action: "update_slide", slideId: "b", slide: { elements: [{ kind: "shape", shape: "ellipse" }] } });
    expect(elementsOf(slidesMap(env.doc).get("b")!).get(box)).toBeDefined();
    expect(slide("b").elements.filter((e) => e.kind === "shape")).toHaveLength(1);
  });

  it("does not take html, and writes nothing when the slide is invalid", async () => {
    await expect(run({ action: "update_slide", slideId: "a", slide: { html: "<p>x</p>" } })).rejects.toMatchObject({ status: 400 });
    await expect(run({ action: "update_slide", slideId: "a", slide: { layoutId: "nope" } })).rejects.toMatchObject({ status: 400 });
    expect(env.transact).not.toHaveBeenCalled();
  });

  it("reports an unknown slide id as not found and writes nothing", async () => {
    await expect(run({ action: "update_slide", slideId: "zz", slide: { notes: "x" } })).rejects.toMatchObject({ status: 404 });
    expect(env.transact).not.toHaveBeenCalled();
  });

  it("requires slideId and slide, and is refused for a viewer", async () => {
    await expect(run({ action: "update_slide", slideId: "a" })).rejects.toMatchObject({ status: 400 });
    decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: false });
    await expect(run({ action: "update_slide", slideId: "a", slide: { notes: "x" } })).rejects.toMatchObject({ status: 403 });
  });
});

describe("manage_slide_deck delete_slide and move_slide", () => {
  it("delete_slide tombstones the slide and returns the rest of the deck", async () => {
    const out = await run({ action: "delete_slide", slideId: "b" });
    expect(isDeleted(slidesMap(env.doc).get("b")!)).toBe(true);
    expect(out.slides.map((s: { id: string }) => s.id)).toEqual(["a", "c"]);
    expect(env.transact).toHaveBeenCalledWith("p1", "u1", expect.any(Function));
    expect(env.pageUpdate).toHaveBeenCalledWith({ where: { id: "p1" }, data: { lastEditedById: "u1" } });
  });

  it("move_slide reorders without recreating the slide, clamped to the deck", async () => {
    const before = slidesMap(env.doc).get("a");
    await run({ action: "move_slide", slideId: "a", toIndex: 2 });
    expect(ids()).toEqual(["b", "c", "a"]);
    expect(slidesMap(env.doc).get("a")).toBe(before);
    await run({ action: "move_slide", slideId: "a", toIndex: 50 });
    expect(ids()).toEqual(["b", "c", "a"]);
    await run({ action: "move_slide", slideId: "a", toIndex: 0 });
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("reports an unknown slide id as not found and writes nothing", async () => {
    await expect(run({ action: "delete_slide", slideId: "zz" })).rejects.toMatchObject({ status: 404 });
    await expect(run({ action: "move_slide", slideId: "zz", toIndex: 0 })).rejects.toMatchObject({ status: 404 });
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("requires each action's fields and refuses a viewer", async () => {
    await expect(run({ action: "move_slide", slideId: "a" })).rejects.toMatchObject({ status: 400 });
    decks.deckAccess.mockResolvedValue({ ok: true, page: PAGE, canEdit: false });
    await expect(run({ action: "delete_slide", slideId: "a" })).rejects.toMatchObject({ status: 403 });
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("passes on access failures with their status", async () => {
    decks.deckAccess.mockResolvedValueOnce({ ok: false, status: 404, error: "Slide deck not found." });
    await expect(run({ action: "get" })).rejects.toMatchObject({ status: 404 });
  });
});
