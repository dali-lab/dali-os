// Whether the desktop app shows its tab strip. Tabs are a desktop-only feature:
// a browser never shows them, whatever this says. On by default in the app.
//
// Stored in a cookie rather than localStorage so the layout loader can reserve
// the strip on the server: the client only learns it is inside the desktop app
// after hydration (window.__DALI_DESKTOP), and without the hint the strip would
// pop in and shift the page. It is a layout hint only, never a permission.

import type { DesktopTab, DesktopTabsState } from "~/lib/desktop-tabs";

export const TAB_STRIP_COOKIE = "dali_tabstrip";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type TabStripCookie = "1" | "0" | null;

export function parseTabStripCookie(cookieString: string): TabStripCookie {
  for (const part of cookieString.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k?.trim() !== TAB_STRIP_COOKIE) continue;
    const v = rest.join("=").trim();
    return v === "1" || v === "0" ? v : null;
  }
  return null;
}

export function tabStripHintFromRequest(request: Request): boolean {
  return parseTabStripCookie(request.headers.get("Cookie") ?? "") === "1";
}

/** The desktop app's choice: on unless the user turned tabs off. */
export function tabsPreferred(cookie: TabStripCookie): boolean {
  return cookie !== "0";
}

export function tabStripCookieHeader(value: "1" | "0"): string {
  return `${TAB_STRIP_COOKIE}=${value}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}

export function readTabStripCookie(): TabStripCookie {
  if (typeof document === "undefined") return null;
  return parseTabStripCookie(document.cookie);
}

export function writeTabStripCookie(value: "1" | "0"): void {
  if (typeof document === "undefined") return;
  document.cookie = tabStripCookieHeader(value);
}

// The open tabs, mirrored into a cookie so the server can draw the strip with
// them: the real set lives in localStorage, which only the client can read, so
// without this every full page load paints an empty strip until hydration.
// Display only (id, url, label, pinned, preview); the store stays the truth.
export const TABS_SNAPSHOT_COOKIE = "dali_tabs";

const SNAPSHOT_MAX_TABS = 20;
const SNAPSHOT_MAX_LABEL = 40;
const SNAPSHOT_MAX_URL = 300;
const SNAPSHOT_MAX_BYTES = 3000;

type SnapshotRow = [id: string, url: string, label: string, flags: number];
type Snapshot = { a: string | null; t: SnapshotRow[] };

const PINNED = 1;
const PREVIEW = 2;

export function encodeTabsSnapshot(state: DesktopTabsState): string {
  const rows: SnapshotRow[] = state.tabs
    .filter((t) => t.url.length <= SNAPSHOT_MAX_URL)
    .slice(0, SNAPSHOT_MAX_TABS)
    .map((t) => [
      t.id,
      t.url,
      t.label.slice(0, SNAPSHOT_MAX_LABEL),
      (t.pinned ? PINNED : 0) | (t.ephemeral ? PREVIEW : 0),
    ]);
  let encoded = "";
  do {
    encoded = encodeURIComponent(JSON.stringify({ a: state.activeId, t: rows } satisfies Snapshot));
  } while (encoded.length > SNAPSHOT_MAX_BYTES && rows.pop());
  return encoded;
}

export function parseTabsSnapshot(cookieString: string): DesktopTabsState | null {
  for (const part of cookieString.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k?.trim() !== TABS_SNAPSHOT_COOKIE) continue;
    try {
      const raw = JSON.parse(decodeURIComponent(rest.join("=").trim())) as Partial<Snapshot>;
      if (!Array.isArray(raw.t)) return null;
      const tabs: DesktopTab[] = raw.t
        .filter(
          (r): r is SnapshotRow =>
            Array.isArray(r) &&
            typeof r[0] === "string" &&
            typeof r[1] === "string" &&
            typeof r[2] === "string" &&
            typeof r[3] === "number",
        )
        .map(([id, url, label, flags]) => ({
          id,
          url,
          origin: url,
          label,
          pinned: (flags & PINNED) !== 0,
          ephemeral: (flags & PREVIEW) !== 0,
          lastActivatedAt: 0,
          scrollY: 0,
          backStack: [],
          forwardStack: [],
        }));
      const activeId = typeof raw.a === "string" && tabs.some((t) => t.id === raw.a) ? raw.a : null;
      return { tabs, activeId, closed: [] };
    } catch {
      return null;
    }
  }
  return null;
}

export function tabsSnapshotFromRequest(request: Request): DesktopTabsState | null {
  return parseTabsSnapshot(request.headers.get("Cookie") ?? "");
}

export function writeTabsSnapshotCookie(state: DesktopTabsState): void {
  if (typeof document === "undefined") return;
  document.cookie = `${TABS_SNAPSHOT_COOKIE}=${encodeTabsSnapshot(state)}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}
