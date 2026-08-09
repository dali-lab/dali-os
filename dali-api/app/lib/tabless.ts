// Device-scoped "tabless mode" preference. Lives in a cookie rather than
// localStorage because the layout loader must branch on it server-side: the
// tabbed workspace and the direct-render shell are different SSR trees, so a
// client-only flag would hydrate the wrong one. Self-contained on purpose —
// lib/cookies.ts is the session-credential module and stays out of the client
// bundle.
//
// Tabless is the default: no cookie (or any value except "0") renders the
// direct shell; "0" is the explicit opt-in to the tabbed workspace.

export const TABLESS_COOKIE = "dali_tabless";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function tablessFromCookies(cookieString: string): boolean {
  for (const part of cookieString.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k?.trim() === TABLESS_COOKIE) return rest.join("=").trim() !== "0";
  }
  return true;
}

export function isTablessRequest(request: Request): boolean {
  return tablessFromCookies(request.headers.get("Cookie") ?? "");
}

// Whether this device has ever made an explicit choice either way, as
// opposed to just riding the default. Callers that want to plant a
// non-default starting preference (e.g. desktop's handoff route) check this
// first so they don't clobber a choice the user already made.
export function hasExplicitTablessPreference(request: Request): boolean {
  const cookieString = request.headers.get("Cookie") ?? "";
  return cookieString
    .split(";")
    .some((part) => part.split("=")[0]?.trim() === TABLESS_COOKIE);
}

export function readTablessPreference(): boolean {
  if (typeof document === "undefined") return true;
  return tablessFromCookies(document.cookie);
}

export function tablessCookieHeader(on: boolean): string {
  // Persist both choices (rather than deleting on the default) so an explicit
  // pick survives a future default change.
  return `${TABLESS_COOKIE}=${on ? "1" : "0"}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}

export function setTablessPreference(on: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = tablessCookieHeader(on);
}
