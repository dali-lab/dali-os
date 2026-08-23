// Assembles a self-contained print HTML document for a BlockNote document:
// the FULL editor DOM (blocksToFullHtml) + BlockNote's own stylesheet + a small
// print/brand layer. Feeding this to headless Chromium (see render.server.ts)
// produces a PDF that matches the on-screen editor — same markup, same CSS —
// rather than a hand-drawn re-layout. Everything is inlined so the render needs
// no network.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { blocksToFullHtml, type DocBlock } from "~/collab/blocknote-server";
import { getObjectBytes } from "~/lib/s3";

const require = createRequire(import.meta.url);

// BlockNote's editor stylesheet, read once from the installed package (it ships
// in the runtime image as a prod dependency). If it can't be found the document
// still renders via the print layer below — just without editor-exact spacing.
let blocknoteCssCache: string | null = null;
function blocknoteCss(): string {
  if (blocknoteCssCache !== null) return blocknoteCssCache;
  const candidates = [
    () => require.resolve("@blocknote/core/dist/style.css"),
    () => join(dirname(require.resolve("@blocknote/core/package.json")), "dist/style.css"),
  ];
  for (const resolve of candidates) {
    try {
      blocknoteCssCache = readFileSync(resolve(), "utf8");
      return blocknoteCssCache;
    } catch {
      // try the next candidate
    }
  }
  console.warn("[pdf] @blocknote/core stylesheet not found; rendering without it");
  blocknoteCssCache = "";
  return blocknoteCssCache;
}

// Print + brand layer: page geometry, a sans body (system stack — the brand's
// Open Sans/Dosis fall back cleanly), a document title, and light styling for
// signing fields so signature/initial/text values read as filled-in lines.
const PRINT_CSS = `
  @page { size: Letter; margin: 0.85in; }
  html, body { padding: 0; margin: 0; background: #fff; }
  body {
    font-family: "Open Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1f2937;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .pdf-title {
    font-family: "Dosis", ui-sans-serif, system-ui, sans-serif;
    font-size: 26px;
    font-weight: 700;
    color: #1E5779;
    margin: 0 0 6px 0;
  }
  .pdf-title-rule { height: 3px; width: 64px; background: #FF8B81; border-radius: 2px; margin-bottom: 20px; }
  /* Neutralise the editor's interactive chrome for a clean printed page. */
  .bn-editor { padding: 0 !important; }
  .bn-block-outer { margin: 0; }
  a { color: #1E5779; }
  /* Filled signing values read as underlined lines; the checkbox glyph stays inline. */
  [data-inline-content-type="signatureField"],
  [data-inline-content-type="initialField"],
  [data-inline-content-type="textField"],
  [data-inline-content-type="dateField"] {
    border-bottom: 1px solid #9ca3af;
    padding: 0 2px;
  }
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Doc-editor media is stored as `/api/upload/raw?key=...` — a relative,
// session-authed redirect. Headless Chromium renders our HTML from about:blank
// with no origin and no cookie, so those <img> src's silently fail to load and
// drop out of the PDF. Inline each referenced object as a data: URI (fetched
// from S3 server-side, where we have the key + creds) so the render is truly
// self-contained. Best-effort: an object that can't be read is left as-is
// rather than failing the whole export.
const UPLOAD_SRC_RE = /src="([^"]*\/api\/upload\/raw\?key=([^"&]+)[^"]*)"/g;

export async function inlineUploadImages(html: string): Promise<string> {
  const keys = new Set<string>();
  for (const m of html.matchAll(UPLOAD_SRC_RE)) keys.add(decodeURIComponent(m[2]));
  if (keys.size === 0) return html;

  const dataUris = new Map<string, string>();
  await Promise.all(
    [...keys].map(async (key) => {
      try {
        const { body, contentType } = await getObjectBytes(key);
        dataUris.set(
          key,
          `data:${contentType || "application/octet-stream"};base64,${body.toString("base64")}`,
        );
      } catch (err) {
        console.error("[pdf] failed to inline upload image:", key, err);
      }
    }),
  );

  return html.replace(UPLOAD_SRC_RE, (whole, _url, enc) => {
    const uri = dataUris.get(decodeURIComponent(enc));
    return uri ? `src="${uri}"` : whole;
  });
}

// Full standalone HTML document for `blocks`, titled `title`. Async because the
// block→HTML conversion runs through the server BlockNote editor.
export async function documentToPrintHtml(title: string, blocks: DocBlock[]): Promise<string> {
  const body = await inlineUploadImages(await blocksToFullHtml(blocks));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>${blocknoteCss()}</style>
<style>${PRINT_CSS}</style>
</head>
<body>
<h1 class="pdf-title">${escapeHtml(title)}</h1>
<div class="pdf-title-rule"></div>
<div class="bn-container bn-default-styles">${body}</div>
</body>
</html>`;
}
