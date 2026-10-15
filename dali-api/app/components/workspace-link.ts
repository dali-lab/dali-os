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

/**
 * The form the workspace stores and navigates by: path + query + hash. A link
 * handed over as a full URL on our own origin (the desktop shell's new-tab
 * hand-off does this) is reduced to that; anything else is left alone.
 */
export function workspacePath(url: string, origin: string): string {
  if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return url;
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    return url;
  }
  if (parsed.origin !== origin) return url;
  return parsed.pathname + parsed.search + parsed.hash;
}
