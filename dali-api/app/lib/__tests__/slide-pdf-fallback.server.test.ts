import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const db = vi.hoisted(() => ({ page: { findUnique: vi.fn() }, slideDeck: { findUnique: vi.fn(), upsert: vi.fn() } }));
const mocks = vi.hoisted(() => ({ getPageAccess: vi.fn(), readLiveDeck: vi.fn(), render: vi.fn() }));

vi.mock("~/lib/db.server", () => ({ prisma: db, Prisma: {} }));
vi.mock("~/lib/pageAccess.server", () => ({ PAGE_ACCESS_SELECT: {}, getPageAccess: mocks.getPageAccess }));
vi.mock("~/collab/deck-live.server", () => ({ readLiveDeck: mocks.readLiveDeck }));
vi.mock("~/collab/deck-convert.server", () => ({ convertDeckToYjs: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/pdf/render.server", () => ({ renderHtmlToPdf: mocks.render }));
vi.mock("~/lib/pdf/print-html.server", () => ({ inlineUploadImages: async (html: string) => html }));

import { exportDeckPdf } from "~/lib/slide-pdf.server";
import { RenderTimeoutError } from "~/lib/pdf/render-guard.server";
import { readDeck } from "~/collab/read-deck.server";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { addHtml } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";

function live(withHtml: boolean) {
  const doc = new Y.Doc();
  initDeck(doc);
  const id = addSlide(doc, "blank", null);
  if (withHtml) addHtml(doc, id, "<script>while(true){}</script>", { fill: true });
  return { read: readDeck(doc), updatedAt: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.page.findUnique.mockResolvedValue({ id: "p1", kind: "Slides", archivedAt: null, title: "Deck", iconEmoji: null });
  mocks.getPageAccess.mockResolvedValue({ canView: true, canEdit: false, canComment: false });
  db.slideDeck.findUnique.mockResolvedValue({ storage: "yjs" });
});

describe("PDF export with custom HTML", () => {
  it("renders the frames under the guard and the 15s deadline", async () => {
    mocks.readLiveDeck.mockResolvedValue(live(true));
    mocks.render.mockResolvedValue(Buffer.from("%PDF"));
    const out = await exportDeckPdf("u1", "p1", { notes: false });
    expect(out).toMatchObject({ ok: true });
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(mocks.render.mock.calls[0][0]).toContain("<iframe");
    expect(mocks.render.mock.calls[0][1]).toEqual({ settleHtmlFrames: true, guardNetwork: true, hardTimeoutMs: 15_000 });
  });

  it("re-renders with placeholder cards and scripts off when the first render times out", async () => {
    mocks.readLiveDeck.mockResolvedValue(live(true));
    mocks.render.mockRejectedValueOnce(new RenderTimeoutError(15_000)).mockResolvedValueOnce(Buffer.from("%PDF2"));
    const out = await exportDeckPdf("u1", "p1", { notes: false });
    expect(out).toEqual({ ok: true, pdf: Buffer.from("%PDF2"), filename: "Deck.pdf" });
    expect(mocks.render).toHaveBeenCalledTimes(2);
    const [markup, opts] = mocks.render.mock.calls[1];
    expect(markup).not.toContain("<iframe");
    expect(markup).not.toContain("while(true)");
    expect(markup).toContain("Custom HTML");
    expect(opts).toEqual({ guardNetwork: true, javaScriptEnabled: false, hardTimeoutMs: 15_000 });
  });

  it("does not hide other failures behind the fallback", async () => {
    mocks.readLiveDeck.mockResolvedValue(live(true));
    mocks.render.mockRejectedValue(new Error("chromium missing"));
    await expect(exportDeckPdf("u1", "p1", { notes: false })).rejects.toThrow("chromium missing");
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });

  it("guards and bounds a deck with no custom HTML too, without frame settling", async () => {
    mocks.readLiveDeck.mockResolvedValue(live(false));
    mocks.render.mockResolvedValue(Buffer.from("%PDF"));
    await exportDeckPdf("u1", "p1", { notes: false });
    expect(mocks.render.mock.calls[0][1]).toEqual({ guardNetwork: true, hardTimeoutMs: 15_000 });
    expect(mocks.render.mock.calls[0][0]).toContain("fonts.googleapis.com/css2");
  });

  it("retries a plain deck without the font link when the first render times out", async () => {
    mocks.readLiveDeck.mockResolvedValue(live(false));
    mocks.render.mockRejectedValueOnce(new RenderTimeoutError(15_000)).mockResolvedValueOnce(Buffer.from("%PDF2"));
    await exportDeckPdf("u1", "p1", { notes: false });
    expect(mocks.render.mock.calls[1][0]).not.toContain("fonts.googleapis.com");
  });
});
