import { useEffect } from "react";
import {
  applyTheme,
  readThemePreference,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
} from "~/lib/theme";

/** Keeps <html> class in sync with localStorage + system preference, including
 *  parent↔iframe messages so the shell and embedded tabs match. */
export function ThemeSync() {
  useEffect(() => {
    applyTheme();

    function refresh() {
      applyTheme(readThemePreference());
    }
    function onStorage(e: StorageEvent) {
      if (e.key === THEME_STORAGE_KEY) refresh();
    }
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (!e.data || e.data.type !== THEME_CHANGE_EVENT) return;
      refresh();
      // Shell: forward to sibling iframes so every open tab updates.
      if (window.parent === window) {
        for (const frame of Array.from(document.querySelectorAll("iframe"))) {
          try {
            frame.contentWindow?.postMessage(
              { type: THEME_CHANGE_EVENT },
              window.location.origin,
            );
          } catch {
            // ignore
          }
        }
      }
    }
    function onMedia() {
      if (readThemePreference() === "system") refresh();
    }

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_CHANGE_EVENT, refresh);
    window.addEventListener("message", onMessage);
    mq.addEventListener("change", onMedia);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_CHANGE_EVENT, refresh);
      window.removeEventListener("message", onMessage);
      mq.removeEventListener("change", onMedia);
    };
  }, []);

  return null;
}
