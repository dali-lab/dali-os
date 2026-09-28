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
import type { PageTypography } from "~/lib/page-typography";

const require = createRequire(import.meta.url);

// BlockNote's editor stylesheet, read once from the installed package (it ships
// in the runtime image as a prod dependency). If it can't be found the document
// still renders via the print layer below — just without editor-exact spacing.
let blocknoteCssCache: string | null = null;
function blocknoteCss(): string {
  if (blocknoteCssCache !== null) return blocknoteCssCache;
  const candidates = [
    // The package's exports map only exposes the sheet as "./style.css" —
    // "dist/style.css" and "package.json" are not resolvable subpaths.
    () => require.resolve("@blocknote/core/style.css"),
    () => join(dirname(require.resolve("@blocknote/core")), "style.css"),
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

// Print layer: page geometry plus the doc editor's own look (app.css os light
// tokens + components/doc/theme.css), so the PDF reads like the paper on screen.
// BlockNote scopes its table rules under .bn-editor, so the body is wrapped in
// one (see documentToPrintHtml); the rules below undo that class's editing
// chrome. Brand fonts load from Google Fonts in the app — the render has no
// network, so each stack falls back to the installed sans.
const PRINT_CSS = `
  @page { size: Letter; margin: 0.85in; }
  html, body { padding: 0; margin: 0; background: #fff; }
  body {
    --doc-font: "Mulish", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-family: var(--doc-font);
    color: #13293a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body.doc-font-serif { --doc-font: ui-serif, Georgia, Cambria, "Times New Roman", serif; }
  body.doc-font-mono { --doc-font: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .pdf-title {
    font-family: var(--doc-font);
    font-size: 36px;
    font-weight: 500;
    line-height: 1.25;
    margin: 0 0 16px 0;
  }
  body.doc-small .pdf-title { font-size: 30px; }
  .bn-default-styles { font-family: var(--doc-font); color: inherit; }
  body.doc-small .bn-editor { font-size: 14px; }
  .bn-editor { padding: 0 !important; }
  .bn-block-outer { margin: 0; }
  /* Headings and table rows shouldn't strand across a page break. */
  .bn-block-content[data-content-type="heading"] { break-after: avoid; }
  tr { break-inside: avoid; }

  a { color: #0f6e7d; }
  .bn-inline-content a[href] { text-decoration: underline; text-underline-offset: 2px; }

  /* Tables: BlockNote's cell borders apply via the .bn-editor wrapper; drop the
     gutter it reserves for the (absent) add-row/column handles. */
  .bn-block-content[data-content-type="table"] { display: block; }
  .bn-editor [data-content-type="table"] .tableWrapper { padding: 0; overflow: visible; }
  .bn-editor [data-content-type="table"] table { border-collapse: collapse; table-layout: fixed; max-width: 100%; }
  .bn-editor [data-content-type="table"] th,
  .bn-editor [data-content-type="table"] td { vertical-align: top; }
  /* Column widths as in the editor: a resized column carries its width on the
     <col>; the rest take the default width BlockNote puts on the table. */
  .bn-editor [data-content-type="table"] col:not([style*="width"]) {
    width: var(--default-cell-min-width, 120px);
  }

  /* Toggles print expanded: the button is interactive chrome, the children are content. */
  .bn-toggle-button { display: none; }
  .bn-block:has(> .bn-block-content > div > .bn-toggle-wrapper) > .bn-block-group { display: block !important; }

  /* Page break: the break itself comes from BlockNote's print rule; hide the on-screen line. */
  .bn-block-content[data-content-type="pageBreak"] > div { border-top: none; margin: 0; }

  /* Callout: the tinted box from the editor (theme.css section 3). */
  .bn-block:has(> .bn-block-content[data-content-type="callout"]) {
    background: #fdf8e6;
    border: 1px solid #f5e0a3;
    border-left: 3px solid #eab308;
    border-radius: 8px;
    padding: 6px 12px;
    margin: 4px 0;
  }
  .bn-block:has(> .bn-block-content[data-emoji="🚨"]) { background: #fdecec; border-color: #f4bebe; border-left-color: #dc2626; }
  .bn-block:has(> .bn-block-content[data-emoji="✅"]) { background: #e9f6ee; border-color: #b9e3c7; border-left-color: #16a34a; }
  .bn-block:has(> .bn-block-content[data-emoji="📌"]) { background: #e8f3f4; border-color: #b3d6da; border-left-color: #0f6e7d; }
  [data-callout] { display: flex; align-items: flex-start; gap: 8px; width: 100%; }
  [data-callout] > span { flex: none; width: 20px; text-align: center; }
  [data-callout] > div { flex: 1; min-width: 0; }
  .bn-block:has(> .bn-block-content[data-content-type="callout"]) > .bn-block-group { margin-left: 28px; }

  /* Bookmark/embed card. */
  a[data-embed] {
    display: block;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #ccd7e2;
    border-radius: 8px;
    color: inherit;
    font-weight: 500;
    text-decoration: none;
  }

  /* Mention chips, as in the editor. */
  [data-mention-id] { border-radius: 4px; padding: 1px 4px; font-weight: 500; color: #c2410c; background: #ffe8e6; }
  [data-page-mention-id] { border-radius: 4px; padding: 1px 4px; font-weight: 500; background: #eef2f6; }

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

function typographyClasses(t: PageTypography | undefined): string {
  if (!t) return "";
  const classes: string[] = [];
  if (t.font !== "default") classes.push(`doc-font-${t.font}`);
  if (t.smallText) classes.push("doc-small");
  return classes.join(" ");
}

// Full standalone HTML document for `blocks`, titled `title`, honoring the
// page's "Aa" typography prefs when given. Async because the block→HTML
// conversion runs through the server BlockNote editor.
export async function documentToPrintHtml(
  title: string,
  blocks: DocBlock[],
  typography?: PageTypography,
): Promise<string> {
  const body = await inlineUploadImages(await blocksToFullHtml(blocks));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>${blocknoteCss()}</style>
<style>${PRINT_CSS}</style>
</head>
<body class="${typographyClasses(typography)}">
<h1 class="pdf-title">${escapeHtml(title)}</h1>
<div class="bn-container bn-default-styles"><div class="bn-editor">${body}</div></div>
</body>
</html>`;
}
