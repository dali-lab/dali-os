import { useEffect } from "react";
import {
  applyTheme,
  readThemePreference,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
} from "~/lib/theme";

/** Keeps <html> class in sync with localStorage + system preference. */
export function ThemeSync() {
  useEffect(() => {
    applyTheme();

    function refresh() {
      applyTheme(readThemePreference());
    }
    function onStorage(e: StorageEvent) {
      if (e.key === THEME_STORAGE_KEY) refresh();
    }
    function onMedia() {
      if (readThemePreference() === "system") refresh();
    }

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_CHANGE_EVENT, refresh);
    mq.addEventListener("change", onMedia);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_CHANGE_EVENT, refresh);
      mq.removeEventListener("change", onMedia);
    };
  }, []);

  return null;
}
