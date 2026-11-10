import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { presentable } from "~/components/slides/deck/skip";
import { HtmlPrintFrame } from "~/components/slides/deck/content-render";
import { slideHasHtml } from "~/components/slides/deck/html-element";
import { SlideRender } from "~/components/slides/deck/SlideRender";
import { themeTokenCss, themeFontsHref } from "~/components/slides/deck/theme-tokens";
import { themeById } from "~/components/slides/deck/themes";
import { STAGE_H, STAGE_W } from "~/components/slides/deck/layouts";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import { inlineUploadImages } from "./print-html.server";

export const MAX_PDF_SLIDES = 200;

export const deckHasHtml = (slides: RenderSlide[]): boolean => slideHasHtml(presentable(slides));

const PRINT_CSS = `
  @page { size: ${STAGE_W}px ${STAGE_H}px; margin: 0; }
  *, *::before, *::after { box-sizing: border-box; border: 0 solid; }
  html, body { margin: 0; padding: 0; background: #fff; }
  :root {
    ${themeTokenCss()}
    --font-os: "Mulish", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --font-os-logo: "Plus Jakarta Sans", "Mulish", ui-sans-serif, system-ui, sans-serif;
  }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: var(--font-os); }
  .pdf-page { width: ${STAGE_W}px; height: ${STAGE_H}px; overflow: hidden; position: relative; break-after: page; break-inside: avoid; }
  .pdf-page:last-child { break-after: auto; }
  .pdf-notes { background: #fff; color: #13293a; padding: 96px 120px; }
  .pdf-notes-label { font-size: 28px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #5b6b7a; margin: 0 0 32px; }
  .pdf-notes-body { font-size: 40px; line-height: 1.45; white-space: pre-wrap; margin: 0; }
  .pdf-notes-empty { color: #8a97a3; }

  [data-slide-stage] p, [data-slide-stage] h3, [data-slide-stage] h4, [data-slide-stage] h5,
  [data-slide-stage] blockquote, [data-slide-stage] pre, [data-slide-stage] ul, [data-slide-stage] ol,
  [data-slide-stage] hr { margin: 0; }
  [data-slide-stage] h3, [data-slide-stage] h4, [data-slide-stage] h5 { font-weight: inherit; }
  [data-slide-stage] h3 { font-size: 1.4em; }
  [data-slide-stage] h4 { font-size: 1.25em; }
  [data-slide-stage] h5 { font-size: 1.1em; }
  [data-slide-stage] img { display: block; max-width: 100%; }
  [data-slide-stage] ul, [data-slide-stage] ol { list-style: none; padding: 0; }
  [data-slide-stage] .space-y-\\[0\\.5em\\] > * + * { margin-top: 0.5em; }
  [data-slide-stage] .list-disc { list-style: disc; padding-left: 1.2em; }
  [data-slide-stage] .list-decimal { list-style: decimal; padding-left: 1.2em; }
  [data-slide-stage] li + li { margin-top: 0.625rem; }
  [data-slide-stage] li > div { margin-top: 0.625rem; }
  [data-slide-stage] .flex { display: flex; }
  [data-slide-stage] .items-start { align-items: flex-start; }
  [data-slide-stage] .gap-3 { gap: 0.75rem; }
  [data-slide-stage] .line-through { text-decoration: line-through; opacity: 0.6; }
  [data-slide-stage] .font-bold { font-weight: 700; }
  [data-slide-stage] .underline { text-decoration: underline; }
  [data-slide-stage] .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  [data-slide-stage] code { border-radius: 6px; padding: 0.05em 0.3em; font-size: 0.85em; }
  [data-slide-stage] pre { overflow: hidden; border-radius: 12px; padding: 0.6em 0.8em; font-size: 0.8em; line-height: 1.625; }
  [data-slide-stage] pre code { padding: 0; font-size: inherit; }
  [data-slide-stage] blockquote { border-left-width: 6px; padding-left: 0.8em; }
  [data-slide-stage] hr { border-top-width: 1px; }
  [data-slide-stage] img.rounded-xl { border-radius: 12px; }
  [data-slide-stage] span.inline-block { display: inline-block; flex-shrink: 0; width: 0.6em; height: 0.6em; margin-top: 0.35em; border-width: 2px; border-radius: 4px; }
`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface DeckPrintInput {
  title: string;
  themeId: string;
  slides: RenderSlide[];
  notes?: Record<string, string>;
  /** Draw custom HTML as its placeholder card instead of a running frame. */
  staticHtml?: boolean;
  /** Load the theme fonts from Google Fonts. Off for a retry that must not wait on the network. */
  fonts?: boolean;
}

/** Every slide at 1920 by 1080 on its own page with all builds showing, each followed by a notes page when `notes` is given. */
export async function deckToPrintHtml({ title, themeId, slides, notes, staticHtml = false, fonts = true }: DeckPrintInput): Promise<string> {
  const pages = presentable(slides).map((slide, i) => {
    const page = `<section class="pdf-page" data-slide-id="${escapeHtml(slide.id)}">${renderToStaticMarkup(
      SlideRender({
        slide,
        theme: themeId,
        renderFree: ({ element, placed, fallback }) =>
          element.kind === "html" && !staticHtml ? createElement(HtmlPrintFrame, { element, placed, theme: themeById(themeId) }) : fallback,
      }),
    )}</section>`;
    if (!notes) return page;
    const text = (notes[slide.id] ?? "").trim();
    const body = text
      ? `<p class="pdf-notes-body">${escapeHtml(text)}</p>`
      : `<p class="pdf-notes-body pdf-notes-empty">No notes.</p>`;
    return `${page}<section class="pdf-page pdf-notes" data-notes-for="${escapeHtml(slide.id)}"><p class="pdf-notes-label">Notes for slide ${i + 1}</p>${body}</section>`;
  });
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
${fonts ? `<link rel="stylesheet" href="${themeFontsHref()}" />` : ""}
<style>${PRINT_CSS}</style>
</head>
<body>${pages.join("")}</body>
</html>`;
  return inlineUploadImages(html);
}
