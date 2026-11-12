// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(),
  redirectPartnerToPortal: vi.fn(),
  pageFind: vi.fn(),
  pageFindOrThrow: vi.fn(),
  deckAccess: vi.fn(),
  loadDeck: vi.fn(),
  migrate: vi.fn(),
  readLiveDeck: vi.fn(),
  token: vi.fn(),
  canManage: vi.fn(),
  transact: vi.fn(),
  slidesLive: vi.fn(),
  isCore: vi.fn(),
}));

vi.mock("~/lib/auth", () => ({ requireAuth: m.requireAuth, isNonMember: m.isNonMember, redirectPartnerToPortal: m.redirectPartnerToPortal }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/db.server", () => ({ prisma: { page: { findUnique: m.pageFind, findUniqueOrThrow: m.pageFindOrThrow } } }));
vi.mock("~/lib/user-pages.server", () => ({ recordPageVisit: vi.fn() }));
vi.mock("~/lib/slide-decks.server", () => ({
  deckAccess: m.deckAccess,
  loadDeck: m.loadDeck,
  saveDeck: vi.fn(),
  migrateDeckOnOpen: m.migrate,
}));
vi.mock("~/drive/lib/drive-page-trail.server", () => ({ loadDrivePageAncestry: vi.fn(async () => ({ title: "Deck", iconEmoji: null, workspaceType: "Lab" })) }));
vi.mock("~/lib/slide-live.server", () => ({ slidesLiveEnabled: m.slidesLive }));
vi.mock("~/collab/deck-live.server", () => ({ readLiveDeck: m.readLiveDeck, transactDeck: m.transact }));
vi.mock("~/lib/roles", () => ({ isCore: m.isCore }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: m.token }));
vi.mock("~/lib/presence-user", () => ({ getPresenceUser: vi.fn(async () => ({ name: "Ada Lovelace", photoUrl: null })) }));
vi.mock("~/lib/page-share-access.server", () => ({ canManageSharing: m.canManage }));
vi.mock("~/components/slides/collab/SlidesEditor", () => ({
  SlidesEditor: (p: { canEdit: boolean; actionsSlot?: unknown }) =>
    createElement("div", { "data-testid": "live-editor", "data-can-edit": String(p.canEdit), "data-actions": p.actionsSlot ? "yes" : "no" }),
}));
vi.mock("~/components/slides/live/DeckFollowLayer", () => ({
  DeckFollowLayer: (p: { viewerId: string; canEdit: boolean; token: string | null; children: unknown }) =>
    createElement("div", { "data-testid": "follow-layer", "data-viewer": p.viewerId, "data-can-edit": String(p.canEdit), "data-token": p.token ?? "" }, p.children as never),
}));
vi.mock("~/components/slides/live/PresentMenu", () => ({ PresentMenu: () => null }));
vi.mock("~/components/slides/collab/ReadOnlyDeck", () => ({
  ReadOnlyDeck: (p: { slides: unknown[]; notice?: string }) =>
    createElement("div", { "data-testid": "read-only" }, `${p.slides.length} slides${p.notice ? ` | ${p.notice}` : ""}`),
}));
vi.mock("~/components/shell/page-bar-slot", () => ({ PageBarTitle: () => null }));
vi.mock("~/components/slides/pptx/DeckDownloadItems", () => ({
  DeckDownloadItems: (p: { pageId: string }) => createElement("a", { "data-testid": "download-pptx", href: `/slides/${p.pageId}/export.pptx` }),
}));
vi.mock("~/components/slides/SlideViewer", () => ({ SlideViewer: () => createElement("div", { "data-testid": "legacy-viewer" }) }));
vi.mock("~/components/slides/editor/SlideEditorWorkspace", () => ({ SlideEditorWorkspace: () => createElement("div", { "data-testid": "legacy-editor" }) }));
vi.mock("~/components/slides/useDeckAutosave", () => ({
  useDeckAutosave: (slides: unknown[]) => ({ slides, edit: vi.fn(), state: "saved", error: null, retry: vi.fn() }),
}));
vi.mock("react-router", async (orig) => ({ ...(await orig<typeof import("react-router")>()), useRevalidator: () => ({ revalidate: vi.fn() }) }));

import SlideDeckPage, { loader } from "../slides.$pageId";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const request = new Request("https://dali.test/slides/p1");
const run = (over: Record<string, unknown> = {}) => loader({ request, params: { pageId: "p1" }, ...over } as never) as Promise<Record<string, any>>;
const live = (v: unknown = 1) => ({
  read: {
    v,
    themeId: "dali-dark",
    plainText: "",
    slides: [
      {
        id: "a",
        pos: 1,
        layoutId: "section",
        notes: { blocks: [], text: "" },
        elements: [{ id: "title", kind: "text", slot: "title", z: 1, src: null, alt: null, textStyle: "kicker", blocks: [], text: "Hi" }],
      },
    ],
  },
  updatedAt: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1", firstName: "Ada", lastName: "L", email: "ada@example.edu" } });
  m.isNonMember.mockResolvedValue(false);
  m.redirectPartnerToPortal.mockResolvedValue(null);
  m.pageFind.mockResolvedValue({ kind: "Slides" });
  m.pageFindOrThrow.mockResolvedValue({ title: "Deck", iconEmoji: null, workspaceType: "Lab", workspaceId: null, parentPageId: null, createdById: "u1" });
  m.deckAccess.mockResolvedValue({ ok: true, canEdit: true, canComment: true, page: {} });
  m.isCore.mockResolvedValue(false);
  m.loadDeck.mockResolvedValue({ slides: [{ id: "s", layout: "title", title: "T" }], version: "v1", storage: "json" });
  m.migrate.mockResolvedValue("yjs");
  m.readLiveDeck.mockResolvedValue(live());
  m.token.mockResolvedValue("tok");
  m.canManage.mockResolvedValue(true);
  m.slidesLive.mockResolvedValue(false);
});

describe("loader", () => {
  it("a live deck opens the collaborative editor for someone who can edit", async () => {
    const out = await run();
    expect(out).toMatchObject({ mode: "live", canEdit: true, canManageAccess: true, unknownVersion: false, deck: null });
    expect(out.collab).toEqual({ token: "tok", userId: "u1", userName: "Ada Lovelace", photoUrl: null });
    expect(m.loadDeck).not.toHaveBeenCalled();
  });

  it("tells the editor whether the viewer can comment and moderate comments", async () => {
    expect(await run()).toMatchObject({ canComment: true, canModerateComments: false });
    m.deckAccess.mockResolvedValue({ ok: true, canEdit: false, canComment: false, page: {} });
    m.isCore.mockResolvedValue(true);
    expect(await run()).toMatchObject({ canComment: false, canModerateComments: true });
  });

  it("passes the slide and thread a comment link names", async () => {
    const linked = new Request("https://dali.test/slides/p1?slide=s9&thread=t3");
    expect((await run({ request: linked })).link).toEqual({ slideId: "s9", threadId: "t3" });
    expect((await run()).link).toEqual({ slideId: null, threadId: null });
  });

  it("a JSON deck is moved to live storage on open, then opens the same way", async () => {
    await run();
    expect(m.migrate).toHaveBeenCalledWith("u1", "p1", request);
  });

  it("a JSON deck with the flag off stays on the legacy editor", async () => {
    m.migrate.mockResolvedValue("json");
    const out = await run();
    expect(out).toMatchObject({ mode: "legacy", canEdit: true, version: "v1" });
    expect(out.slides).toHaveLength(1);
    expect(m.readLiveDeck).not.toHaveBeenCalled();
  });

  it("someone who can only view gets the live read-only connection", async () => {
    m.deckAccess.mockResolvedValue({ ok: true, canEdit: false, page: {} });
    const out = await run();
    expect(out).toMatchObject({ mode: "live", canEdit: false, deck: null });
    expect(out.collab).toMatchObject({ token: "tok", userId: "u1" });
  });

  it("falls back to the loader snapshot for a viewer without a collab token", async () => {
    m.deckAccess.mockResolvedValue({ ok: true, canEdit: false, page: {} });
    m.token.mockResolvedValue(null);
    const out = await run();
    expect(out.collab).toBeNull();
    expect(out.deck.themeId).toBe("dali-dark");
    expect(out.deck.slides[0]).toMatchObject({ id: "a", layoutId: "section" });
    expect(out.deck.slides[0].elements[0].textStyle).toBe("kicker");
  });

  it("repairs a deck with missing slots on the server, only for an editor", async () => {
    await run();
    expect(m.transact).toHaveBeenCalledWith("p1", "u1", expect.any(Function));
    m.transact.mockClear();
    m.deckAccess.mockResolvedValue({ ok: true, canEdit: false, page: {} });
    await run();
    expect(m.transact).not.toHaveBeenCalled();
  });

  it("does not touch a deck whose slots are all there", async () => {
    const d = live();
    d.read.slides[0].layoutId = "content";
    d.read.slides[0].elements = ["title", "body"].map((slot) => ({ id: slot, kind: "text", slot, z: 1, src: null, alt: null, textStyle: null, blocks: [], text: "" })) as never;
    m.readLiveDeck.mockResolvedValue(d);
    await run();
    expect(m.transact).not.toHaveBeenCalled();
  });

  it("a deck version this build does not know is read-only even for an editor", async () => {
    m.readLiveDeck.mockResolvedValue(live(2));
    const out = await run();
    expect(out).toMatchObject({ mode: "live", unknownVersion: true, collab: null });
    expect(out.deck.slides).toHaveLength(1);
  });

  it("with slides-live off, nothing about presenting reaches the page", async () => {
    const out = await run();
    expect(out.slidesLive).toBe(false);
    expect(out.deck).toBeNull();
  });

  it("with slides-live on, an editor also gets the deck copy followers fall back to", async () => {
    m.slidesLive.mockResolvedValue(true);
    const out = await run();
    expect(out).toMatchObject({ slidesLive: true, viewerId: "u1" });
    expect(out.deck.slides[0].id).toBe("a");
  });

  it("hides a deck the user can't see", async () => {
    m.deckAccess.mockResolvedValue({ ok: false, status: 404, error: "no" });
    await expect(run()).rejects.toMatchObject({ status: 404 });
  });
});

describe("page", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const render = (loaderData: unknown) => {
    act(() => root.render(createElement(SlideDeckPage as never, { loaderData } as never)));
    return container;
  };
  const base = { pageId: "p1", title: "Deck", iconEmoji: null, canEdit: true };

  it("mounts the collaborative editor for a live deck with credentials", () => {
    const el = render({ ...base, mode: "live", canManageAccess: true, workspaceType: "Lab", unknownVersion: false, deck: null, collab: { token: "t", userId: "u", userName: "A", photoUrl: null } });
    expect(el.querySelector("[data-testid=live-editor]")).not.toBeNull();
  });

  it("mounts the live editor for a viewer too, told they can't edit", () => {
    const el = render({ ...base, canEdit: false, mode: "live", canManageAccess: false, workspaceType: "Lab", unknownVersion: false, deck: null, collab: { token: "t", userId: "u", userName: "A", photoUrl: null } });
    expect(el.querySelector("[data-testid=live-editor]")!.getAttribute("data-can-edit")).toBe("false");
  });

  it("draws a viewer's deck read-only without the editor", () => {
    const el = render({ ...base, canEdit: false, mode: "live", canManageAccess: false, workspaceType: "Lab", unknownVersion: false, collab: null, deck: { themeId: "dali-dark", slides: [{}, {}] } });
    expect(el.querySelector("[data-testid=live-editor]")).toBeNull();
    expect(el.querySelector("[data-testid=read-only]")!.textContent).toBe("2 slides");
    expect(el.querySelector("[data-testid=download-pptx]")!.getAttribute("href")).toBe("/slides/p1/export.pptx");
  });

  it("adds the Present button and the follow layer only when slides-live is on", () => {
    const editor = { ...base, mode: "live", canManageAccess: true, workspaceType: "Lab", unknownVersion: false, viewerId: "u", deck: { themeId: "dali-dark", slides: [] }, collab: { token: "t", userId: "u", userName: "A", photoUrl: null } };
    const off = render({ ...editor, slidesLive: false });
    expect(off.querySelector("[data-testid=follow-layer]")).toBeNull();
    expect(off.querySelector("[data-testid=live-editor]")!.getAttribute("data-actions")).toBe("no");
    const on = render({ ...editor, slidesLive: true });
    const layer = on.querySelector("[data-testid=follow-layer]")!;
    expect(layer.getAttribute("data-can-edit")).toBe("true");
    expect(layer.getAttribute("data-token")).toBe("t");
    expect(on.querySelector("[data-testid=live-editor]")!.getAttribute("data-actions")).toBe("yes");
  });

  it("gives a viewer the follow layer but no Present button", () => {
    const el = render({ ...base, canEdit: false, mode: "live", canManageAccess: false, workspaceType: "Lab", unknownVersion: false, slidesLive: true, viewerId: "v", deck: { themeId: "dali-dark", slides: [] }, collab: { token: "t", userId: "v", userName: "V", photoUrl: null } });
    expect(el.querySelector("[data-testid=follow-layer]")!.getAttribute("data-can-edit")).toBe("false");
    expect(el.querySelector("[data-testid=live-editor]")!.getAttribute("data-actions")).toBe("no");
  });

  it("wraps a read-only deck without a token in the follow layer", () => {
    const el = render({ ...base, canEdit: false, mode: "live", canManageAccess: false, workspaceType: "Lab", unknownVersion: false, slidesLive: true, viewerId: "v", collab: null, deck: { themeId: "dali-dark", slides: [] } });
    const layer = el.querySelector("[data-testid=follow-layer]")!;
    expect(layer.getAttribute("data-token")).toBe("");
    expect(layer.querySelector("[data-testid=read-only]")).not.toBeNull();
  });

  it("says why an unknown version is read-only", () => {
    const el = render({ ...base, mode: "live", canManageAccess: false, workspaceType: "Lab", unknownVersion: true, collab: null, deck: { themeId: "dali-dark", slides: [] } });
    expect(el.querySelector("[data-testid=read-only]")!.textContent).toContain("newer version of Slides");
  });

  it("keeps the legacy editor for a JSON deck, and the legacy viewer for a viewer", () => {
    const legacy = { ...base, mode: "legacy", slides: [{ id: "s", layout: "title", title: "T" }], version: "v1", storage: "json" };
    expect(render(legacy).querySelector("[data-testid=legacy-editor]")).not.toBeNull();
    expect(render({ ...legacy, canEdit: false }).querySelector("[data-testid=legacy-viewer]")).not.toBeNull();
    expect(container.querySelector("[data-testid=live-editor]")).toBeNull();
  });
});
