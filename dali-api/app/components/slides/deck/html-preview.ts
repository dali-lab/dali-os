import { createContext } from "react";

export const HTML_PREVIEW_SETTLE_MS = 2500;

/** Bump when the frame document changes, so stored pictures drawn from the old one are redrawn. */
export const HTML_PREVIEW_REVISION = 2;

export interface PreviewSize {
  w: number;
  h: number;
}

export function htmlPreviewSize(rect: { w: number; h: number }): PreviewSize {
  return { w: Math.min(Math.max(1, Math.round(rect.w)), 3840), h: Math.min(Math.max(1, Math.round(rect.h)), 2160) };
}

/** FNV-1a over everything the picture depends on, so the browser and the server name the same render the same way. */
export function htmlPreviewVersion(html: string, themeId: string, size: PreviewSize): string {
  const input = `${HTML_PREVIEW_REVISION}|${themeId}|${size.w}x${size.h}|${html}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const htmlPreviewUrl = (pageId: string, elementId: string, version: string): string =>
  `/slides/${encodeURIComponent(pageId)}/html-preview/${encodeURIComponent(elementId)}?v=${version}`;

export const HtmlPreviewContext = createContext<{ pageId: string } | null>(null);
