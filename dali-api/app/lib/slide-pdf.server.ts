import { deckAccess, readDeckModel } from "~/lib/slide-decks.server";
import { notesBySlide, toRenderDeck } from "~/collab/read-deck.server";
import { deckHasHtml, deckToPrintHtml, MAX_PDF_SLIDES } from "~/lib/pdf/slides-print-html.server";
import { PDF_HARD_TIMEOUT_MS, RenderTimeoutError } from "~/lib/pdf/render-guard.server";
import { renderHtmlToPdf } from "~/lib/pdf/render.server";

export function pdfFilename(title: string): string {
  return title.replace(/[^A-Za-z0-9 ._-]/g, "").trim().replace(/\s+/g, "_") || "slides";
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
  const read = await readDeckModel(pageId);
  if (read.slides.length > MAX_PDF_SLIDES) {
    return { ok: false, status: 413, error: `This deck has more than ${MAX_PDF_SLIDES} slides, which is too many to export as one PDF.` };
  }
  const render = toRenderDeck(read);
  const input = { title: access.page.title, themeId: render.themeId, slides: render.slides, notes: opts.notes ? notesBySlide(read) : undefined };
  const hasHtml = deckHasHtml(render.slides);
  const guarded = { guardNetwork: true, hardTimeoutMs: PDF_HARD_TIMEOUT_MS };
  let pdf: Buffer;
  try {
    pdf = await renderHtmlToPdf(await deckToPrintHtml(input), hasHtml ? { ...guarded, settleHtmlFrames: true } : guarded);
  } catch (err) {
    if (!(err instanceof RenderTimeoutError)) throw err;
    pdf = await renderHtmlToPdf(await deckToPrintHtml({ ...input, staticHtml: true, fonts: false }), { ...guarded, javaScriptEnabled: false });
  }
  return { ok: true, pdf, filename: `${pdfFilename(access.page.title)}.pdf` };
}
