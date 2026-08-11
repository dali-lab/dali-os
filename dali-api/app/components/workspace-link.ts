// When a page is rendered inside a TabWorkspace iframe, a regular Link click
// would navigate the iframe itself — replacing the source view (dashboard,
// list, etc.) with the destination. Instead, ask the parent shell to open a
// new workspace tab so the source view stays put.
//
// Returns true if the request was sent (caller should preventDefault). Returns
// false when we're at top-level (no iframe) — let the normal Link navigate.
export function requestOpenTabIfEmbedded(url: string, label: string): boolean {
  if (typeof window === "undefined") return false;
  if (window.self === window.top) return false;
  window.parent.postMessage(
    { type: "dali:openTab", url, label },
    window.location.origin,
  );
  return true;
}

// The command palette lives in the app shell, so a page that wants to open it
// has to ask: inside a TabWorkspace iframe the shell is the parent window;
// in tabless mode it's this window, where Layout listens for the same event.
export const OPEN_PALETTE_MESSAGE = "dali:openPalette";

export function requestOpenPalette(): void {
  if (typeof window === "undefined") return;
  if (window.self !== window.top) {
    window.parent.postMessage({ type: OPEN_PALETTE_MESSAGE }, window.location.origin);
    return;
  }
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_MESSAGE));
}
