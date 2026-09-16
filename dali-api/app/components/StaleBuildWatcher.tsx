import { useEffect } from "react";
import { isBuildStale, reloadForNewBuild } from "~/lib/stale-build";

/** Only re-check after the page has been away at least this long. */
const AWAY_THRESHOLD_MS = 60_000;

function isEditingSomething(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * When someone comes back to a tab (or the desktop app window) after a while,
 * check whether a deploy happened in the meantime and, if so, reload onto the
 * new build *before* they click into a page the old bundle can no longer load.
 * Skipped while focus is in a field so a half-typed input isn't thrown away —
 * the root ErrorBoundary still recovers if the stale bundle crashes later.
 * Also catches Vite's module-preload failures, which are the same problem.
 */
export function StaleBuildWatcher() {
  useEffect(() => {
    let awaySince: number | null = document.hidden ? Date.now() : null;
    let checking = false;

    const onReturn = async () => {
      const away = awaySince;
      awaySince = null;
      if (away === null || Date.now() - away < AWAY_THRESHOLD_MS) return;
      if (checking) return;
      checking = true;
      try {
        if ((await isBuildStale()) && !isEditingSomething()) reloadForNewBuild();
      } finally {
        checking = false;
      }
    };
    const onLeave = () => {
      if (awaySince === null) awaySince = Date.now();
    };
    // Window blur also fires when focus moves into a same-origin workspace
    // iframe; the document still has focus then, so that isn't "away".
    const onBlur = () => {
      setTimeout(() => {
        if (!document.hasFocus()) onLeave();
      }, 0);
    };

    const onVisibility = () => (document.hidden ? onLeave() : void onReturn());
    // The desktop webview doesn't always flip visibility when the window is
    // backgrounded, so blur/focus is tracked too.
    const onFocus = () => void onReturn();

    const onPreloadError = (event: Event) => {
      if (reloadForNewBuild()) event.preventDefault();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("vite:preloadError", onPreloadError);
    };
  }, []);

  return null;
}
