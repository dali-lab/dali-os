import * as Y from "yjs";
import { deckAccess, deckStorage, loadDeck } from "~/lib/slide-decks.server";
import { readLiveDeck } from "~/collab/deck-live.server";
import { seedDeckDoc } from "~/collab/deck-write.server";
import { notesBySlide, readDeck, toRenderDeck, type DeckRead } from "~/collab/read-deck.server";
import { deckToPrintHtml, MAX_PDF_SLIDES } from "~/lib/pdf/slides-print-html.server";
import { renderHtmlToPdf } from "~/lib/pdf/render.server";

export function pdfFilename(title: string): string {
  return title.replace(/[^A-Za-z0-9 ._-]/g, "").trim().replace(/\s+/g, "_") || "slides";
}

async function readDeckForPdf(pageId: string): Promise<DeckRead> {
  if ((await deckStorage(pageId)) === "yjs") return (await readLiveDeck(pageId)).read;
  const { slides } = await loadDeck(pageId);
  const doc = new Y.Doc();
  try {
    seedDeckDoc(doc, slides);
    return readDeck(doc);
  } finally {
    doc.destroy();
  }
}

export type DeckPdfResult =
  | { ok: true; pdf: Buffer; filename: string }
  | { ok: false; status: number; error: string };

export async function exportDeckPdf(
  userId: string,
  pageId: string,
  opts: { notes: boolean },
  request?: Request,
): Promise<DeckPdfResult> {
  const access = await deckAccess(userId, pageId, request);
  if (!access.ok) return access;
  if (opts.notes && !access.canEdit) return { ok: false, status: 403, error: "Only people who can edit this deck can export its notes." };
  const read = await readDeckForPdf(pageId);
  if (read.slides.length > MAX_PDF_SLIDES) {
    return { ok: false, status: 413, error: `This deck has more than ${MAX_PDF_SLIDES} slides, which is too many to export as one PDF.` };
  }
  const render = toRenderDeck(read);
  const html = await deckToPrintHtml({
    title: access.page.title,
    themeId: render.themeId,
    slides: render.slides,
    notes: opts.notes ? notesBySlide(read) : undefined,
  });
  const pdf = await renderHtmlToPdf(html);
  return { ok: true, pdf, filename: `${pdfFilename(access.page.title)}.pdf` };
}
