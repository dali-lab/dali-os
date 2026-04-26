// Launch-party easter-egg helpers. Nothing here affects app behavior —
// it's all opt-in cosmetic state persisted to localStorage.

export const EXTERNAL_CODE = "DALI";
export const INTERNAL_CODE = "LABS";

const RETRO_KEY = "dali:party:retro";
const CLICK_KEY = "dali:party:logo-clicks";
const UNLOCK_EXT_KEY = "dali:party:unlock-external";
const UNLOCK_INT_KEY = "dali:party:unlock-internal";

export function isExternalCodeUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(UNLOCK_EXT_KEY) === "1";
}

export function isInternalCodeUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(UNLOCK_INT_KEY) === "1";
}

export function setExternalCodeUnlocked(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) window.localStorage.setItem(UNLOCK_EXT_KEY, "1");
  else window.localStorage.removeItem(UNLOCK_EXT_KEY);
}

export function setInternalCodeUnlocked(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) window.localStorage.setItem(UNLOCK_INT_KEY, "1");
  else window.localStorage.removeItem(UNLOCK_INT_KEY);
}

export function isRetroOn(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(RETRO_KEY) === "1";
}

export function setRetro(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) window.localStorage.setItem(RETRO_KEY, "1");
  else window.localStorage.removeItem(RETRO_KEY);
  document.documentElement.classList.toggle("dali-retro", on);
}

// Returns the new click count. Every 10th click toggles retro mode.
export function bumpLogoClick(): number {
  if (typeof window === "undefined") return 0;
  const prev = Number(window.sessionStorage.getItem(CLICK_KEY) ?? "0");
  const next = prev + 1;
  if (next >= 10) {
    setRetro(!isRetroOn());
    window.sessionStorage.setItem(CLICK_KEY, "0");
    return 0;
  }
  window.sessionStorage.setItem(CLICK_KEY, String(next));
  return next;
}

export function hydrateRetroClass() {
  if (typeof window === "undefined") return;
  if (isRetroOn()) document.documentElement.classList.add("dali-retro");
}
