import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(),
  redirectPartnerToPortal: vi.fn(),
  deckAccess: vi.fn(),
  migrate: vi.fn(),
  liveEnabled: vi.fn(),
  readLiveDeck: vi.fn(),
  token: vi.fn(),
}));

vi.mock("~/lib/auth", () => ({ requireAuth: m.requireAuth, isNonMember: m.isNonMember, redirectPartnerToPortal: m.redirectPartnerToPortal }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/login" } })) }));
vi.mock("~/lib/slide-decks.server", () => ({ deckAccess: m.deckAccess, migrateDeckOnOpen: m.migrate }));
vi.mock("~/lib/slide-live.server", () => ({ slidesLiveEnabled: m.liveEnabled }));
vi.mock("~/collab/deck-live.server", () => ({ readLiveDeck: m.readLiveDeck }));
vi.mock("~/collab/read-deck.server", () => ({
  toRenderDeck: (read: { slides: unknown[] }) => ({ themeId: "dali-dark", slides: read.slides }),
  notesBySlide: () => ({ a: "speaker notes" }),
}));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: m.token }));

import { loader as presentLoader } from "../slides.$pageId.present";
import { loader as presenterLoader } from "../slides.$pageId.presenter";

const request = (qs = "") => new Request(`https://dali.test/slides/p1/present${qs}`);
const run = (loader: Loader, qs = "") => loader({ request: request(qs), params: { pageId: "p1" } } as never) as Promise<Record<string, any>>;

beforeEach(() => {
  vi.clearAllMocks();
  m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  m.isNonMember.mockResolvedValue(false);
  m.redirectPartnerToPortal.mockResolvedValue(null);
  m.liveEnabled.mockResolvedValue(true);
  m.deckAccess.mockResolvedValue({ ok: true, canEdit: true, page: { id: "p1", title: "Deck" } });
  m.migrate.mockResolvedValue("yjs");
  m.readLiveDeck.mockResolvedValue({ read: { slides: [{ id: "a" }] } });
  m.token.mockResolvedValue("tok");
});

type Loader = (args: never) => Promise<unknown>;
const loaders: Array<[string, Loader]> = [
  ["present", presentLoader as Loader],
  ["presenter", presenterLoader as Loader],
];

describe.each(loaders)("%s route access", (_name, loader) => {
  it("is a 404 when slides-live is off for the person", async () => {
    m.liveEnabled.mockResolvedValue(false);
    await expect(run(loader)).rejects.toMatchObject({ status: 404 });
    expect(m.deckAccess).not.toHaveBeenCalled();
  });

  it("is a 404 for a deck the person can't see", async () => {
    m.deckAccess.mockResolvedValue({ ok: false, status: 404, error: "no" });
    await expect(run(loader)).rejects.toMatchObject({ status: 404 });
  });

  it("sends a deck that hasn't moved to live editing back to its ordinary page", async () => {
    m.migrate.mockResolvedValue("json");
    await expect(run(loader)).rejects.toMatchObject({ status: 302, headers: expect.anything() });
  });

  it("sends someone who isn't signed in to log in", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    await expect(run(loader)).rejects.toBeInstanceOf(Response);
    expect(m.deckAccess).not.toHaveBeenCalled();
  });

  it("gives an editor the room token, the notes and the slide to start from", async () => {
    const out = await run(loader, "?slide=b");
    expect(out).toMatchObject({ pageId: "p1", title: "Deck", viewerId: "u1", canDrive: true, token: "tok", startSlideId: "b" });
    expect(out.deck).toMatchObject({ themeId: "dali-dark", notes: { a: "speaker notes" } });
  });
});

describe("a viewer", () => {
  beforeEach(() => m.deckAccess.mockResolvedValue({ ok: true, canEdit: false, page: { id: "p1", title: "Deck" } }));

  it("opens the slide show to follow, connected read-only, with no notes", async () => {
    const out = await run(presentLoader);
    expect(out).toMatchObject({ canDrive: false, token: "tok", startSlideId: null });
    expect(out.deck.notes).toEqual({});
  });

  it("is sent back to the deck from the presenter view", async () => {
    const thrown = await run(presenterLoader).catch((e: Response) => e);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe("/slides/p1");
  });
});
