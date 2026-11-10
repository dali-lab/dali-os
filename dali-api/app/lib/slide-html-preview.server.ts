import type { DeckRead } from "~/collab/read-deck.server";
import { htmlFrameDocument } from "~/components/slides/deck/html-element";
import { htmlPreviewSize, htmlPreviewVersion } from "~/components/slides/deck/html-preview";
import { themeById } from "~/components/slides/deck/themes";
import { renderHtmlToPng } from "~/lib/pdf/render.server";
import { getObjectWithMetadata, isS3Configured, putObject } from "~/lib/s3";

export const htmlPreviewKey = (pageId: string, elementId: string): string => `slides/html-previews/${pageId}/${elementId}.png`;

export interface HtmlPreview {
  png: Buffer;
  version: string;
}

const inflight = new Map<string, Promise<HtmlPreview | null>>();

function findHtmlElement(read: DeckRead, elementId: string) {
  for (const slide of read.slides) {
    const el = slide.elements.find((e) => e.id === elementId);
    if (el) return el.kind === "html" && el.w !== undefined && el.h !== undefined ? el : null;
  }
  return null;
}

/** The element's picture, rendered only when what it depends on changed since the stored one. Null when it cannot be had. */
export async function getHtmlPreview(pageId: string, elementId: string, read: DeckRead): Promise<HtmlPreview | null> {
  if (!isS3Configured()) return null;
  const el = findHtmlElement(read, elementId);
  if (!el) return null;
  const theme = themeById(read.themeId);
  const size = htmlPreviewSize({ w: el.w!, h: el.h! });
  const html = el.html ?? "";
  const version = htmlPreviewVersion(html, theme.id, size);
  const key = htmlPreviewKey(pageId, elementId);
  const flightKey = `${key}@${version}`;
  const running = inflight.get(flightKey);
  if (running) return running;
  const work = (async () => {
    const stored = await getObjectWithMetadata(key);
    if (stored && stored.metadata.v === version) return { png: stored.body, version };
    const data = await renderHtmlToPng(htmlFrameDocument(html, theme, size.w, size.h), size);
    if (!data) return null;
    const png = Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
    await putObject(key, png, "image/png", { v: version });
    return { png, version };
  })().finally(() => inflight.delete(flightKey));
  inflight.set(flightKey, work);
  return work;
}
