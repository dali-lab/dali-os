// "Open in new tab" inside the desktop app.
//
// The desktop shell (desktop/) is a single WKWebView with no tabs and no window
// chrome of its own, and WKWebView drops every "new window" request on the
// floor: `target="_blank"` anchors, ⌘-click, and `window.open` (which returns
// null) all do exactly nothing. The doc editor's own link toolbar is the most
// visible casualty — its "Open in new tab" button is a `window.open` call, so
// clicking it in the app looks broken.
//
// The shell can't be asked to help directly: the remote window has no IPC by
// design (desktop/src-tauri/capabilities/main-remote.json). What it does have
// is `nav::on_navigation`, which every top-frame navigation passes through and
// which hands any cross-origin URL to the system browser and then CANCELS the
// in-webview navigation — the page stays exactly where it was. So a link the
// webview can't open in a tab becomes a navigation the shell turns into a
// browser hand-off, and an in-app link becomes a real workspace tab via the
// `dali:openTab` message the embedded pages already use.
//
// Browsers keep their own tabs: none of this installs unless we're in the shell.

import { desktopVersion } from "~/lib/desktop";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";

export type DesktopLinkAction =
  /** Not ours to redirect — let the webview do whatever it would have done. */
  | { kind: "default" }
  /** In-app URL, and we're in a workspace tab: ask the shell for another tab. */
  | { kind: "tab"; url: string }
  /** In-app URL with no workspace to open into: go there in this window. */
  | { kind: "navigate"; url: string }
  /** Off-site URL: navigate the top frame so the shell hands it to the OS. */
  | { kind: "handOff"; url: string };

/** Schemes the shell passes to the OS on navigation, the same as an off-site
 *  link. `javascript:`, `blob:` and `data:` are deliberately absent: those are
 *  the page's own business and a hand-off would break them. */
const HAND_OFF_SCHEMES = new Set(["mailto:", "tel:", "sms:", "facetime:"]);

/**
 * What the shell should do with a link that asked for a new tab. Pure, so the
 * decision is testable without a webview: `base` resolves relative hrefs,
 * `origin` is the app's own origin, `embedded` is true inside a workspace tab.
 */
export function resolveDesktopLink(
  href: string,
  ctx: { origin: string; base: string; embedded: boolean },
): DesktopLinkAction {
  let url: URL;
  try {
    url = new URL(href, ctx.base);
  } catch {
    return { kind: "default" };
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    if (url.origin !== ctx.origin) return { kind: "handOff", url: url.href };
    return ctx.embedded ? { kind: "tab", url: url.href } : { kind: "navigate", url: url.href };
  }
  if (HAND_OFF_SCHEMES.has(url.protocol)) return { kind: "handOff", url: url.href };
  return { kind: "default" };
}

function currentContext() {
  let embedded = false;
  try {
    embedded = window.self !== window.top;
  } catch {
    embedded = true; // cross-origin top — treat as embedded, never navigate it
  }
  return { origin: window.location.origin, base: window.location.href, embedded };
}

/** Carry out a resolved action. Returns false for `default`, so callers can
 *  fall through to the behaviour they would otherwise have had. */
function perform(action: DesktopLinkAction, label: string): boolean {
  switch (action.kind) {
    case "tab":
      return requestOpenTabIfEmbedded(action.url, label || action.url);
    case "navigate":
      window.location.assign(action.url);
      return true;
    case "handOff": {
      // The TOP frame on purpose: the shell watches the main frame's
      // navigations, and it cancels this one, so the page doesn't move.
      let target: Window = window;
      try {
        target = window.top ?? window;
      } catch {
        target = window;
      }
      target.location.href = action.url;
      return true;
    }
    default:
      return false;
  }
}

/**
 * Route new-tab requests through the shell. Call once per document (every
 * workspace iframe is its own document, so every one installs its own). A no-op
 * outside the desktop app, and idempotent.
 */
export function installDesktopLinkHandling(): void {
  if (typeof window === "undefined") return;
  if (!desktopVersion()) return;
  const flagged = window as Window & { __daliDesktopLinks?: boolean };
  if (flagged.__daliDesktopLinks) return;
  flagged.__daliDesktopLinks = true;

  // `window.open` — the doc editor's link toolbar, the command palette's
  // ⌘Enter, the sidebar's ⌘-click. Returns null either way: in the webview it
  // already did, so no caller can be relying on the handle.
  const nativeOpen = window.open.bind(window);
  window.open = function desktopOpen(
    url?: string | URL,
    target?: string,
    features?: string,
  ): Window | null {
    if (url == null || url === "") return nativeOpen(url as string | undefined, target, features);
    const action = resolveDesktopLink(String(url), currentContext());
    if (action.kind === "default") return nativeOpen(url as string, target, features);
    perform(action, "");
    return null;
  } as typeof window.open;

  // `target="_blank"` anchors, and ⌘/Ctrl-click on any link — both of which the
  // webview would otherwise swallow. Capture phase so a page's own handler
  // can't have navigated the frame before we look at it; anything already
  // handled (defaultPrevented) is left alone.
  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as
        | HTMLAnchorElement
        | null;
      if (!anchor) return;
      const wantsNewTab = anchor.target === "_blank" || event.metaKey || event.ctrlKey;
      if (!wantsNewTab) return;
      const action = resolveDesktopLink(
        anchor.getAttribute("href") ?? "",
        currentContext(),
      );
      if (action.kind === "default") return;
      if (perform(action, anchor.textContent?.trim() ?? "")) event.preventDefault();
    },
    true,
  );
}
