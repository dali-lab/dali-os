// Screen-accurate PDF for a document body — the drop-in the signing routes and
// the receipt email use. Renders the same BlockNote HTML + CSS the editor shows,
// via headless Chromium; if Chromium is unavailable or the render throws, it
// falls back to the pure-JS pdfkit renderer so a download or receipt email never
// hard-fails.

import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import type { DocBlock } from "~/collab/blocknote-server";
import type { PMNode } from "~/collab/export-html";
import { renderProseMirrorToPdf } from "~/collab/export-pdf";
import { documentToPrintHtml } from "./print-html.server";
import { renderHtmlToPdf } from "./render.server";

export async function renderDocumentPdf(
  title: string,
  body: PMNode | DocBlock[],
): Promise<Buffer> {
  try {
    const html = await documentToPrintHtml(title, ensureBlocks(body));
    return await renderHtmlToPdf(html);
  } catch (err) {
    console.error("[pdf] headless render failed; falling back to pdfkit:", err);
    return renderProseMirrorToPdf(title, body);
  }
}
