import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const db = vi.hoisted(() => ({
  page: { findUnique: vi.fn(), update: vi.fn() },
  slideTemplate: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), count: vi.fn() },
}));
const env = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));
vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/page-templates.server", () => ({ canListWorkspace: vi.fn() }));
vi.mock("~/lib/slide-decks.server", () => ({ deckAccess: vi.fn(), deckStorage: vi.fn(), migrateDeckOnOpen: vi.fn(), readDeckModel: vi.fn() }));
vi.mock("~/collab/deck-live.server", () => ({
  transactDeck: vi.fn(async (_p: string, _u: string, fn: (d: Y.Doc) => void) => env.doc.transact(() => fn(env.doc))),
}));

import { isCore } from "~/lib/roles";
import { canListWorkspace } from "~/lib/page-templates.server";
import { deckAccess, deckStorage, migrateDeckOnOpen, readDeckModel } from "~/lib/slide-decks.server";
import { readDeck } from "~/collab/read-deck.server";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { addPoll } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";
import { slidesToClips } from "~/components/slides/deck/slide-clipboard";
import { snapshotDeck } from "~/components/slides/deck/snapshot";
import {
  applyDeckTemplate,
  createSlideTemplate,
  createTemplateSchema,
  deleteSlideTemplate,
  getSlideTemplate,
  isBlankDeck,
  listForScopes,
  listSlideTemplates,
  MAX_TEMPLATES_PER_SCOPE,
} from "../slide-templates.server";

const POLL = { question: "Ship it?", options: ["Yes", "No"] };

function sampleClips() {
  const doc = new Y.Doc();
  initDeck(doc);
  const id = addSlide(doc, "content", null);
  addPoll(doc, id, POLL);
  return slidesToClips(snapshotDeck(doc).slides);
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  kind: "Deck",
  workspaceType: "Lab",
  workspaceId: null,
  title: "Kickoff",
  themeId: "dali-light",
  slideCount: 1,
  payload: sampleClips(),
  createdById: "u1",
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({ kind: "Deck" as const, title: "Kickoff", pageId: "p1", scope: "lab" as const, themeId: "dali-light", slides: sampleClips(), ...over });

function allow(canEdit = true) {
  vi.mocked(deckAccess).mockResolvedValue({ ok: true, page: { id: "p1", title: "T", iconEmoji: null }, canEdit, canComment: true });
}

beforeEach(() => {
  vi.resetAllMocks();
  allow();
  vi.mocked(canListWorkspace).mockResolvedValue(true);
  vi.mocked(isCore).mockResolvedValue(false);
  db.page.findUnique.mockResolvedValue({ workspaceType: "Lab", workspaceId: null });
  db.slideTemplate.count.mockResolvedValue(0);
  db.slideTemplate.create.mockResolvedValue({ id: "new1" });
  env.doc = new Y.Doc();
  initDeck(env.doc);
});

describe("createSlideTemplate", () => {
  it("saves the sanitized slides for the lab, creator recorded", async () => {
    expect(await createSlideTemplate("u1", input())).toEqual({ ok: true, id: "new1" });
    const data = db.slideTemplate.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: "Deck", workspaceType: "Lab", workspaceId: null, title: "Kickoff", themeId: "dali-light", slideCount: 1, createdById: "u1" });
    expect(data.payload[0].items[0].poll).toEqual(POLL);
  });

  it("saves to the deck's project when asked", async () => {
    db.page.findUnique.mockResolvedValue({ workspaceType: "Project", workspaceId: "proj1" });
    await createSlideTemplate("u1", input({ scope: "project" }));
    expect(canListWorkspace).toHaveBeenCalledWith("u1", "Project", "proj1");
    expect(db.slideTemplate.create.mock.calls[0][0].data).toMatchObject({ workspaceType: "Project", workspaceId: "proj1" });
  });

  it("refuses project scope for a deck that is not in a project", async () => {
    expect(await createSlideTemplate("u1", input({ scope: "project" }))).toMatchObject({ ok: false, status: 400 });
    expect(db.slideTemplate.create).not.toHaveBeenCalled();
  });

  it("refuses someone who can only view the deck", async () => {
    allow(false);
    expect(await createSlideTemplate("u1", input())).toMatchObject({ ok: false, status: 403 });
    expect(db.slideTemplate.create).not.toHaveBeenCalled();
  });

  it("refuses someone who cannot see the deck", async () => {
    vi.mocked(deckAccess).mockResolvedValue({ ok: false, status: 404, error: "Slide deck not found." });
    expect(await createSlideTemplate("u1", input())).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a scope the person cannot use", async () => {
    vi.mocked(canListWorkspace).mockResolvedValue(false);
    expect(await createSlideTemplate("u1", input())).toMatchObject({ ok: false, status: 403 });
    expect(db.slideTemplate.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown theme and slides that sanitize to nothing", async () => {
    expect(await createSlideTemplate("u1", input({ themeId: "nope" }))).toMatchObject({ ok: false, status: 400 });
    expect(await createSlideTemplate("u1", input({ slides: ["x"] }))).toMatchObject({ ok: false, status: 400 });
    expect(db.slideTemplate.create).not.toHaveBeenCalled();
  });

  it("refuses a full scope", async () => {
    db.slideTemplate.count.mockResolvedValue(MAX_TEMPLATES_PER_SCOPE);
    expect(await createSlideTemplate("u1", input())).toMatchObject({ ok: false, status: 409 });
  });

  it("validates the request body", () => {
    expect(createTemplateSchema.safeParse(input()).success).toBe(true);
    expect(createTemplateSchema.parse(input({ title: " Kickoff " })).title).toBe("Kickoff");
    expect(createTemplateSchema.safeParse(input({ title: "   " })).success).toBe(false);
    expect(createTemplateSchema.safeParse(input({ kind: "Other" })).success).toBe(false);
    expect(createTemplateSchema.safeParse(input({ slides: [] })).success).toBe(false);
    expect(createTemplateSchema.safeParse(input({ scope: "member" })).success).toBe(false);
  });
});

describe("listing", () => {
  it("lists lab templates, flags what the viewer may delete, and leaves out the payload", async () => {
    db.slideTemplate.findMany.mockResolvedValue([row(), row({ id: "t2", kind: "Slide", createdById: "other" })]);
    const res = await listForScopes("u1", null);
    expect(db.slideTemplate.findMany.mock.calls[0][0].where).toEqual({ OR: [{ workspaceType: "Lab", workspaceId: null }] });
    expect(res.templates.map((t) => [t.id, t.canDelete, t.firstLayoutId])).toEqual([["t1", true, "content"], ["t2", false, "content"]]);
    expect(JSON.stringify(res)).not.toContain("payload");
  });

  it("lets Core delete anyone's", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    db.slideTemplate.findMany.mockResolvedValue([row({ createdById: "other" })]);
    expect((await listForScopes("u1", null)).templates[0].canDelete).toBe(true);
  });

  it("includes the project's templates only when the viewer can use that project", async () => {
    db.slideTemplate.findMany.mockResolvedValue([]);
    await listForScopes("u1", "proj1");
    expect(db.slideTemplate.findMany.mock.calls[0][0].where.OR).toHaveLength(2);
    vi.mocked(canListWorkspace).mockImplementation(async (_u, type) => type === "Lab");
    await listForScopes("u1", "proj1");
    expect(db.slideTemplate.findMany.mock.calls[1][0].where.OR).toHaveLength(1);
  });

  it("returns nothing when the viewer can use no scope", async () => {
    vi.mocked(canListWorkspace).mockResolvedValue(false);
    expect(await listForScopes("u1", null)).toEqual({ templates: [] });
    expect(db.slideTemplate.findMany).not.toHaveBeenCalled();
  });

  it("lists through a deck, reporting whether the project is a save target", async () => {
    db.page.findUnique.mockResolvedValue({ workspaceType: "Project", workspaceId: "proj1" });
    db.slideTemplate.findMany.mockResolvedValue([]);
    expect(await listSlideTemplates("u1", "p1")).toMatchObject({ ok: true, canSaveToProject: true });
    vi.mocked(deckAccess).mockResolvedValue({ ok: false, status: 404, error: "x" });
    expect(await listSlideTemplates("u1", "p1")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("getSlideTemplate", () => {
  it("returns the sanitized slides to someone who can use its scope", async () => {
    db.slideTemplate.findUnique.mockResolvedValue(row());
    const res = await getSlideTemplate("u1", "t1");
    expect(res).toMatchObject({ ok: true, template: { id: "t1", slides: [{ layoutId: "content" }] } });
  });

  it("is a 404 for a missing template or a scope the viewer cannot use", async () => {
    db.slideTemplate.findUnique.mockResolvedValue(null);
    expect(await getSlideTemplate("u1", "t1")).toMatchObject({ ok: false, status: 404 });
    db.slideTemplate.findUnique.mockResolvedValue(row());
    vi.mocked(canListWorkspace).mockResolvedValue(false);
    expect(await getSlideTemplate("u1", "t1")).toMatchObject({ ok: false, status: 404 });
  });

  it("re-sanitizes stored data, so a tampered row cannot inject an unsafe image", async () => {
    db.slideTemplate.findUnique.mockResolvedValue(
      row({ payload: [{ layoutId: "content", slots: [], items: [{ key: "i", kind: "image", src: "javascript:alert(1)", placed: { x: 0, y: 0, w: 10, h: 10, rot: 0 } }] }] }),
    );
    const res = (await getSlideTemplate("u1", "t1")) as { template: { slides: Array<{ items: unknown[] }> } };
    expect(res.template.slides[0].items).toEqual([]);
  });
});

describe("deleteSlideTemplate", () => {
  it("lets the creator delete", async () => {
    db.slideTemplate.findUnique.mockResolvedValue(row());
    expect(await deleteSlideTemplate("u1", "t1")).toEqual({ ok: true });
    expect(db.slideTemplate.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
  });

  it("lets Core delete someone else's", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    db.slideTemplate.findUnique.mockResolvedValue(row({ createdById: "other" }));
    expect(await deleteSlideTemplate("u1", "t1")).toEqual({ ok: true });
  });

  it("refuses another member", async () => {
    db.slideTemplate.findUnique.mockResolvedValue(row({ createdById: "other" }));
    expect(await deleteSlideTemplate("u1", "t1")).toMatchObject({ ok: false, status: 403 });
    expect(db.slideTemplate.delete).not.toHaveBeenCalled();
  });

  it("is a 404 when the template is missing or out of scope", async () => {
    db.slideTemplate.findUnique.mockResolvedValue(null);
    expect(await deleteSlideTemplate("u1", "t1")).toMatchObject({ ok: false, status: 404 });
    db.slideTemplate.findUnique.mockResolvedValue(row());
    vi.mocked(canListWorkspace).mockResolvedValue(false);
    expect(await deleteSlideTemplate("u1", "t1")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("applyDeckTemplate", () => {
  beforeEach(() => {
    db.slideTemplate.findUnique.mockResolvedValue(row({ themeId: "dali-light" }));
    vi.mocked(deckStorage).mockResolvedValue("yjs");
    vi.mocked(readDeckModel).mockImplementation(async () => readDeck(env.doc));
  });

  it("replaces a blank deck's starter slide with the template's slides and theme", async () => {
    const starter = addSlide(env.doc, "title", null);
    const res = await applyDeckTemplate("u1", "p1", "t1");
    expect(res).toMatchObject({ ok: true, slideIds: [expect.any(String)] });
    const read = readDeck(env.doc);
    expect(read.slides.map((s) => s.id)).toEqual((res as { slideIds: string[] }).slideIds);
    expect(read.slides.map((s) => s.id)).not.toContain(starter);
    expect(read.themeId).toBe("dali-light");
    expect(read.slides[0].elements.find((e) => e.kind === "poll")!.poll).toEqual(POLL);
    expect(db.page.update).toHaveBeenCalled();
  });

  it("keeps the slides of a deck that already has content, adding the template's after them", async () => {
    const existing = addSlide(env.doc, "content", null);
    const { slideFragment } = await import("~/components/slides/deck/deck-ops");
    const { writeBlocks } = await import("~/components/slides/pptx/fragment-write");
    writeBlocks(slideFragment(env.doc, existing, "title")!, [{ type: "paragraph", content: [{ type: "text", text: "Mine", styles: {} }], children: [] }]);
    await applyDeckTemplate("u1", "p1", "t1");
    expect(readDeck(env.doc).slides).toHaveLength(2);
    expect(readDeck(env.doc).slides[0].id).toBe(existing);
    expect(readDeck(env.doc).themeId).toBe("dali-dark");
  });

  it("refuses someone who can only view the deck", async () => {
    allow(false);
    expect(await applyDeckTemplate("u1", "p1", "t1")).toMatchObject({ ok: false, status: 403 });
    expect(readDeck(env.doc).slides).toHaveLength(0);
  });

  it("refuses a template outside the person's scope", async () => {
    vi.mocked(canListWorkspace).mockResolvedValue(false);
    expect(await applyDeckTemplate("u1", "p1", "t1")).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a deck that cannot move to the live editor", async () => {
    vi.mocked(deckStorage).mockResolvedValue("json");
    vi.mocked(migrateDeckOnOpen).mockResolvedValue("json");
    expect(await applyDeckTemplate("u1", "p1", "t1")).toMatchObject({ ok: false, status: 400 });
  });

  it("moves a JSON deck to the live editor first when it can", async () => {
    vi.mocked(deckStorage).mockResolvedValue("json");
    vi.mocked(migrateDeckOnOpen).mockResolvedValue("yjs");
    expect(await applyDeckTemplate("u1", "p1", "t1")).toMatchObject({ ok: true });
  });
});

describe("isBlankDeck", () => {
  it("is true for empty slots and false once there is text, an image or a free element", () => {
    const blank = (elements: unknown[]) => isBlankDeck({ slides: [{ elements }] } as never);
    expect(blank([{ slot: "title", kind: "text", blocks: [] }, { slot: "image", kind: "image", src: "" }])).toBe(true);
    expect(blank([{ slot: "title", kind: "text", blocks: [{}] }])).toBe(false);
    expect(blank([{ slot: "image", kind: "image", src: "https://x/y.png" }])).toBe(false);
    expect(blank([{ slot: null, kind: "shape" }])).toBe(false);
  });
});
