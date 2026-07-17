/** Appearance preference for DALI OS. Persisted in localStorage so it applies
 *  across tabs/iframes without a round-trip. */

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "dali:theme";
export const THEME_CHANGE_EVENT = "dali:themeChange";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function resolveDark(preference: ThemePreference): boolean {
  if (preference === "dark") return true;
  if (preference === "light") return false;
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Apply the resolved theme to this document's <html>. */
export function applyTheme(preference: ThemePreference = readThemePreference()) {
  if (typeof document === "undefined") return;
  const dark = resolveDark(preference);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function setThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // private mode / blocked storage — still apply for this session
  }
  applyTheme(preference);
  window.dispatchEvent(
    new CustomEvent(THEME_CHANGE_EVENT, { detail: { preference } }),
  );
  // Tell the shell / sibling iframes (same-origin) so they update immediately.
  // `storage` only fires in *other* documents; this covers the parent↔iframe case.
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        { type: THEME_CHANGE_EVENT, preference },
        window.location.origin,
      );
    }
    window.postMessage(
      { type: THEME_CHANGE_EVENT, preference },
      window.location.origin,
    );
  } catch {
    // ignore cross-origin access errors
  }
}

/** Static boot script path — served from /public so CSP script-src 'self' works. */
export const THEME_BOOT_SRC = "/theme-boot.js";
