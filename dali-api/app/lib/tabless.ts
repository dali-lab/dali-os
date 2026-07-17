// Device-scoped "tabless mode" preference. Lives in a cookie rather than
// localStorage because the layout loader must branch on it server-side: the
// tabbed workspace and the direct-render shell are different SSR trees, so a
// client-only flag would hydrate the wrong one. Self-contained on purpose —
// lib/cookies.ts is the session-credential module and stays out of the client
// bundle.

export const TABLESS_COOKIE = "dali_tabless";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function hasTablessCookie(cookieString: string): boolean {
  return cookieString.split(";").some((part) => {
    const [k, ...rest] = part.split("=");
    return k?.trim() === TABLESS_COOKIE && rest.join("=").trim() === "1";
  });
}

export function isTablessRequest(request: Request): boolean {
  return hasTablessCookie(request.headers.get("Cookie") ?? "");
}

export function readTablessPreference(): boolean {
  if (typeof document === "undefined") return false;
  return hasTablessCookie(document.cookie);
}

export function setTablessPreference(on: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = on
    ? `${TABLESS_COOKIE}=1; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax`
    : `${TABLESS_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}
