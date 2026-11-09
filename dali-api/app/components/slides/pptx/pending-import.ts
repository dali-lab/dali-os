import type { ImportPlan, ReadySlide } from "./import-types";

export interface PendingImport {
  slides: ReadySlide[];
  skipped: ImportPlan["skipped"];
}

const key = (pageId: string) => `slides-import:${pageId}`;

/** Hands a prepared import to the deck page that is about to open. False when the browser won't hold it. */
export function stashImport(pageId: string, pending: PendingImport): boolean {
  try {
    sessionStorage.setItem(key(pageId), JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

/** Reads and clears the import waiting for this deck, so it applies once. */
export function takeImport(pageId: string): PendingImport | null {
  try {
    const raw = sessionStorage.getItem(key(pageId));
    if (!raw) return null;
    sessionStorage.removeItem(key(pageId));
    const parsed = JSON.parse(raw) as PendingImport;
    return Array.isArray(parsed.slides) ? parsed : null;
  } catch {
    return null;
  }
}
