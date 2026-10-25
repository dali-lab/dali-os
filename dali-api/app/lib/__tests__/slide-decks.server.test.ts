import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  page: { findUnique: vi.fn(), update: vi.fn() },
  slideDeck: { upsert: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
}));
const access = vi.hoisted(() => ({ getPageAccess: vi.fn() }));

vi.mock("~/lib/db", () => ({ prisma: db, Prisma: {} }));
vi.mock("~/lib/pageAccess.server", () => ({ PAGE_ACCESS_SELECT: {}, getPageAccess: access.getPageAccess }));

import { DECK_CONFLICT, deckAccess, editDeck, loadDeck, saveDeck } from "~/lib/slide-decks.server";
import type { Slide } from "~/components/slides/types";

const V1 = "2026-10-23T12:00:00.000Z";
const V2 = "2026-10-23T12:00:05.000Z";
const slide = (id: string, title = "T"): Slide => ({ id, layout: "title", title });
const deckPage = { id: "p1", kind: "Slides", archivedAt: null, title: "Deck", iconEmoji: null };

beforeEach(() => {
  vi.clearAllMocks();
  db.page.findUnique.mockResolvedValue(deckPage);
  access.getPageAccess.mockResolvedValue({ canView: true, canEdit: true, canComment: true });
  db.slideDeck.upsert.mockResolvedValue({ slides: [slide("s1")], updatedAt: new Date(V1) });
  db.slideDeck.updateMany.mockResolvedValue({ count: 1 });
  db.slideDeck.findUniqueOrThrow.mockResolvedValue({ updatedAt: new Date(V2) });
  db.page.update.mockResolvedValue({});
});

describe("deckAccess", () => {
  it("returns the page and whether the user can edit", async () => {
    access.getPageAccess.mockResolvedValue({ canView: true, canEdit: false, canComment: true });
    expect(await deckAccess("u1", "p1")).toEqual({
      ok: true,
      page: { id: "p1", title: "Deck", iconEmoji: null },
      canEdit: false,
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

describe("loadDeck", () => {
  it("creates the deck row on first read and returns its slides and version", async () => {
    expect(await loadDeck("p1")).toEqual({ slides: [slide("s1")], version: V1 });
    expect(db.slideDeck.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pageId: "p1" }, create: { pageId: "p1" }, update: {} }),
    );
  });

  it("reads an unreadable stored deck as empty", async () => {
    db.slideDeck.upsert.mockResolvedValue({ slides: { not: "a deck" }, updatedAt: new Date(V1) });
    expect((await loadDeck("p1")).slides).toEqual([]);
  });
});

describe("saveDeck", () => {
  it("writes only when the version still matches, and returns the new one", async () => {
    expect(await saveDeck("u1", "p1", [slide("s2")], V1)).toEqual({ ok: true, version: V2 });
    expect(db.slideDeck.updateMany).toHaveBeenCalledWith({
      where: { pageId: "p1", updatedAt: new Date(V1) },
      data: { slides: [slide("s2")], lastEditedById: "u1" },
    });
    expect(db.page.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { lastEditedById: "u1" } });
  });

  it("refuses with 409 when someone saved in between", async () => {
    db.slideDeck.updateMany.mockResolvedValue({ count: 0 });
    expect(await saveDeck("u1", "p1", [], V1)).toEqual({ ok: false, status: 409, error: DECK_CONFLICT });
    expect(db.page.update).not.toHaveBeenCalled();
  });

  it("refuses viewers without writing", async () => {
    access.getPageAccess.mockResolvedValue({ canView: true, canEdit: false, canComment: true });
    expect(await saveDeck("u1", "p1", [], V1)).toMatchObject({ ok: false, status: 403 });
    expect(db.slideDeck.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a missing version", async () => {
    expect(await saveDeck("u1", "p1", [], "not a date")).toMatchObject({ ok: false, status: 400 });
  });

  it("drops undefined fields before writing", async () => {
    await saveDeck("u1", "p1", [{ ...slide("s1"), notes: undefined }], V1);
    expect(db.slideDeck.updateMany.mock.calls[0][0].data.slides[0]).not.toHaveProperty("notes");
  });
});

describe("editDeck", () => {
  it("applies the edit to the current slides and saves against their version", async () => {
    const result = await editDeck("u1", "p1", (slides) => [...slides, slide("s2")]);
    expect(result).toEqual({ ok: true, slides: [slide("s1"), slide("s2")], version: V2 });
    expect(db.slideDeck.updateMany.mock.calls[0][0].where).toEqual({ pageId: "p1", updatedAt: new Date(V1) });
  });

  it("retries once on a conflict, re-reading the deck", async () => {
    db.slideDeck.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    db.slideDeck.upsert
      .mockResolvedValueOnce({ slides: [slide("s1")], updatedAt: new Date(V1) })
      .mockResolvedValueOnce({ slides: [slide("s1"), slide("other")], updatedAt: new Date(V2) });
    const result = await editDeck("u1", "p1", (slides) => [...slides, slide("mine")]);
    expect(result).toMatchObject({ ok: true, slides: [slide("s1"), slide("other"), slide("mine")] });
  });

  it("gives up with 409 after a second conflict", async () => {
    db.slideDeck.updateMany.mockResolvedValue({ count: 0 });
    expect(await editDeck("u1", "p1", (s) => s)).toEqual({ ok: false, status: 409, error: DECK_CONFLICT });
    expect(db.slideDeck.updateMany).toHaveBeenCalledTimes(2);
  });

  it("refuses an edit that produces an invalid deck", async () => {
    const result = await editDeck("u1", "p1", () => [slide("dup"), slide("dup")]);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(db.slideDeck.updateMany).not.toHaveBeenCalled();
  });

  it("refuses viewers before reading the deck", async () => {
    access.getPageAccess.mockResolvedValue({ canView: true, canEdit: false, canComment: true });
    expect(await editDeck("u1", "p1", (s) => s)).toMatchObject({ ok: false, status: 403 });
    expect(db.slideDeck.upsert).not.toHaveBeenCalled();
  });
});
