// Device-scoped "focus mode": hide the sidebar and navigate with ⌘K and
// breadcrumbs. Cookie-backed (like tabless) so the layout loader decides the
// shell chrome server-side — no flash of the sidebar before it's hidden.
// Sibling of lib/tabless.ts; the two prefs are independent booleans.

export const FOCUS_COOKIE = "dali_focus";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function hasFocusCookie(cookieString: string): boolean {
  return cookieString.split(";").some((part) => {
    const [k, ...rest] = part.split("=");
    return k?.trim() === FOCUS_COOKIE && rest.join("=").trim() === "1";
  });
}

export function isFocusRequest(request: Request): boolean {
  return hasFocusCookie(request.headers.get("Cookie") ?? "");
}

export function readFocusPreference(): boolean {
  if (typeof document === "undefined") return false;
  return hasFocusCookie(document.cookie);
}

export function setFocusPreference(on: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = on
    ? `${FOCUS_COOKIE}=1; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax`
    : `${FOCUS_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}
