import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const db = vi.hoisted(() => ({
  page: { findUnique: vi.fn() },
  slideDeck: { findUnique: vi.fn(), upsert: vi.fn() },
}));
const mocks = vi.hoisted(() => ({ getPageAccess: vi.fn(), readLiveDeck: vi.fn(), render: vi.fn() }));

vi.mock("~/lib/db.server", () => ({ prisma: db, Prisma: {} }));
vi.mock("~/lib/pageAccess.server", () => ({ PAGE_ACCESS_SELECT: {}, getPageAccess: mocks.getPageAccess }));
vi.mock("~/collab/deck-live.server", () => ({ readLiveDeck: mocks.readLiveDeck }));
vi.mock("~/collab/deck-convert.server", () => ({ convertDeckToYjs: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/pdf/render.server", () => ({ renderHtmlToPdf: mocks.render }));
vi.mock("~/lib/pdf/print-html.server", () => ({ inlineUploadImages: async (html: string) => html }));

import { exportDeckPdf, pdfFilename } from "~/lib/slide-pdf.server";
import { MAX_PDF_SLIDES } from "~/lib/pdf/slides-print-html.server";
import { seedDeckDoc } from "~/collab/deck-write.server";
import { readDeck } from "~/collab/read-deck.server";
import { deleteSlide, moveSlide, setThemeId } from "~/components/slides/deck/deck-ops";
import type { Slide } from "~/components/slides/types";

const slide = (id: string, title: string, notes?: string): Slide => ({ id, layout: "title", title, ...(notes ? { notes } : {}) });
const deckPage = { id: "p1", kind: "Slides", archivedAt: null, title: "Q4 / Review: Plan", iconEmoji: null };

function liveDeck(slides: Slide[], edit?: (doc: Y.Doc) => void) {
  const doc = new Y.Doc();
  seedDeckDoc(doc, slides);
  edit?.(doc);
  return { read: readDeck(doc), updatedAt: null };
}

const pages = (html: string) => [...html.matchAll(/<section class="pdf-page"[^>]*data-slide-id="([^"]+)"/g)].map((m) => m[1]);
const html = () => mocks.render.mock.calls[0][0] as string;

beforeEach(() => {
  vi.clearAllMocks();
  db.page.findUnique.mockResolvedValue(deckPage);
  mocks.getPageAccess.mockResolvedValue({ canView: true, canEdit: false, canComment: false });
  db.slideDeck.findUnique.mockResolvedValue({ storage: "yjs" });
  mocks.readLiveDeck.mockResolvedValue(liveDeck([slide("a", "Alpha"), slide("b", "Beta"), slide("c", "Gamma")]));
  mocks.render.mockResolvedValue(Buffer.from("%PDF"));
});

describe("exportDeckPdf", () => {
  it("lets a viewer export and names the file from the title", async () => {
    const out = await exportDeckPdf("u1", "p1", { notes: false });
    expect(out).toEqual({ ok: true, pdf: Buffer.from("%PDF"), filename: "Q4_Review_Plan.pdf" });
  });

  it("hides a deck the user can't view", async () => {
    mocks.getPageAccess.mockResolvedValue({ canView: false, canEdit: false, canComment: false });
    expect(await exportDeckPdf("u2", "p1", { notes: false })).toMatchObject({ ok: false, status: 404 });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("prints one 1920 by 1080 page per slide in position order", async () => {
    mocks.readLiveDeck.mockResolvedValue(liveDeck([slide("a", "Alpha"), slide("b", "Beta"), slide("c", "Gamma")], (d) => moveSlide(d, "c", 0)));
    await exportDeckPdf("u1", "p1", { notes: false });
    expect(pages(html())).toEqual(["c", "a", "b"]);
    expect(html()).toContain("@page { size: 1920px 1080px; margin: 0; }");
  });

  it("leaves out deleted slides", async () => {
    mocks.readLiveDeck.mockResolvedValue(liveDeck([slide("a", "Alpha"), slide("b", "Beta")], (d) => deleteSlide(d, "a")));
    await exportDeckPdf("u1", "p1", { notes: false });
    expect(pages(html())).toEqual(["b"]);
    expect(html()).not.toContain("Alpha");
  });

  it("carries the deck's theme variables on every slide", async () => {
    mocks.readLiveDeck.mockResolvedValue(liveDeck([slide("a", "Alpha"), slide("b", "Beta")], (d) => setThemeId(d, "dali-light")));
    await exportDeckPdf("u1", "p1", { notes: false });
    expect(html().match(/data-theme="dali-light"/g)).toHaveLength(2);
    expect(html()).toContain("--slide-ground");
    expect(html()).toContain("--font-os-logo");
  });

  it("adds no notes pages unless asked", async () => {
    await exportDeckPdf("u1", "p1", { notes: false });
    expect(html()).not.toContain("data-notes-for");
  });

  it("adds a notes page after each slide for an editor, escaping the text", async () => {
    mocks.getPageAccess.mockResolvedValue({ canView: true, canEdit: true, canComment: true });
    mocks.readLiveDeck.mockResolvedValue(liveDeck([slide("a", "Alpha", "Say <hello>"), slide("b", "Beta")]));
    await exportDeckPdf("u1", "p1", { notes: true });
    expect(html().match(/data-notes-for="/g)).toHaveLength(2);
    expect(html().indexOf('data-slide-id="a"')).toBeLessThan(html().indexOf('data-notes-for="a"'));
    expect(html().indexOf('data-notes-for="a"')).toBeLessThan(html().indexOf('data-slide-id="b"'));
    expect(html()).toContain("Say &lt;hello&gt;");
    expect(html()).toContain("No notes.");
  });

  it("refuses notes for a viewer", async () => {
    expect(await exportDeckPdf("u1", "p1", { notes: true })).toMatchObject({ ok: false, status: 403 });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("refuses a deck over the slide cap before rendering", async () => {
    const many = Array.from({ length: MAX_PDF_SLIDES + 1 }, (_, i) => slide(`s${i}`, `S${i}`));
    mocks.readLiveDeck.mockResolvedValue(liveDeck(many));
    const out = await exportDeckPdf("u1", "p1", { notes: false });
    expect(out).toMatchObject({ ok: false, status: 413 });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("exports a deck still in JSON storage through the same model", async () => {
    db.slideDeck.findUnique.mockResolvedValue({ storage: "json" });
    db.slideDeck.upsert.mockResolvedValue({ slides: [slide("j1", "Json one"), slide("j2", "Json two")], updatedAt: new Date(), storage: "json" });
    await exportDeckPdf("u1", "p1", { notes: false });
    expect(mocks.readLiveDeck).not.toHaveBeenCalled();
    expect(pages(html())).toEqual(["j1", "j2"]);
    expect(html()).toContain("Json two");
  });
});

describe("pdfFilename", () => {
  it("strips unsafe characters and falls back when nothing is left", () => {
    expect(pdfFilename('a/b"c\\d  e')).toBe("abcd_e");
    expect(pdfFilename("../../etc")).toBe("....etc");
    expect(pdfFilename("日本語")).toBe("slides");
  });
});
