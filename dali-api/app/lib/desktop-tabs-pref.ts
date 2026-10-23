// Whether the desktop app shows its tab strip. Tabs are a desktop-only feature:
// a browser never shows them, whatever this says. On by default in the app.
//
// Stored in a cookie rather than localStorage so the layout loader can reserve
// the strip on the server: the client only learns it is inside the desktop app
// after hydration (window.__DALI_DESKTOP), and without the hint the strip would
// pop in and shift the page. It is a layout hint only, never a permission.

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
