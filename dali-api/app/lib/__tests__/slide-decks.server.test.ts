import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ page: { findUnique: vi.fn() } }));
const access = vi.hoisted(() => ({ getPageAccess: vi.fn() }));
const live = vi.hoisted(() => ({ readLiveDeck: vi.fn(), ensureLiveDeck: vi.fn() }));

vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/collab/deck-live.server", () => ({ readLiveDeck: live.readLiveDeck }));
vi.mock("~/lib/live-deck.server", () => ({ ensureLiveDeck: live.ensureLiveDeck }));
vi.mock("~/lib/pageAccess.server", () => ({ PAGE_ACCESS_SELECT: {}, getPageAccess: access.getPageAccess }));

import * as decks from "~/lib/slide-decks.server";
import { deckAccess, readDeckModel } from "~/lib/slide-decks.server";

const deckPage = { id: "p1", kind: "Slides", archivedAt: null, title: "Deck", iconEmoji: null };

beforeEach(() => {
  vi.clearAllMocks();
  db.page.findUnique.mockResolvedValue(deckPage);
  access.getPageAccess.mockResolvedValue({ canView: true, canEdit: true, canComment: true });
});

describe("deckAccess", () => {
  it("returns the page and whether the user can edit and comment", async () => {
    access.getPageAccess.mockResolvedValue({ canView: true, canEdit: false, canComment: true });
    expect(await deckAccess("u1", "p1")).toEqual({
      ok: true,
      page: { id: "p1", title: "Deck", iconEmoji: null },
      canEdit: false,
      canComment: true,
    });
  });

  it("hides a page the user can't see", async () => {
    access.getPageAccess.mockResolvedValue({ canView: false, canEdit: false, canComment: false });
    expect(await deckAccess("u1", "p1")).toMatchObject({ ok: false, status: 404 });
  });

  it("treats missing, trashed and non-deck pages as not found", async () => {
    db.page.findUnique.mockResolvedValueOnce(null);
    expect(await deckAccess("u1", "p1")).toMatchObject({ ok: false, status: 404 });
    db.page.findUnique.mockResolvedValueOnce({ ...deckPage, archivedAt: new Date() });
    expect(await deckAccess("u1", "p1")).toMatchObject({ ok: false, status: 404 });
    db.page.findUnique.mockResolvedValueOnce({ ...deckPage, kind: "FreeForm" });
    expect(await deckAccess("u1", "p1")).toMatchObject({ ok: false, status: 404 });
    expect(access.getPageAccess).not.toHaveBeenCalled();
  });
});

describe("readDeckModel", () => {
  it("makes the page a live deck first, then reads the room", async () => {
    const order: string[] = [];
    live.ensureLiveDeck.mockImplementation(async () => void order.push("ensure"));
    live.readLiveDeck.mockImplementation(async () => {
      order.push("read");
      return { read: { v: 1, themeId: "dali-dark", slides: [], plainText: "" }, updatedAt: null };
    });
    expect(await readDeckModel("p1")).toEqual({ v: 1, themeId: "dali-dark", slides: [], plainText: "" });
    expect(live.ensureLiveDeck).toHaveBeenCalledWith("p1");
    expect(order).toEqual(["ensure", "read"]);
  });

  it("has no JSON storage path left", () => {
    for (const name of ["loadDeck", "saveDeck", "editDeck", "deckStorage", "migrateDeckOnOpen"]) {
      expect(name in decks).toBe(false);
    }
  });
});
