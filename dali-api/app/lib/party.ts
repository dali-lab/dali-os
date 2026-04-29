// Launch-party easter-egg helpers. Nothing here affects app behavior —
// it's all opt-in cosmetic state persisted to localStorage.

import { useEffect, useState } from "react";

export const EXTERNAL_CODE = "D4L1";
export const INTERNAL_CODE = "C5DE";

const RETRO_KEY = "dali:party:retro";
const CLICK_KEY = "dali:party:logo-clicks";
const UNLOCK_EXT_KEY = "dali:party:unlock-external";
const UNLOCK_INT_KEY = "dali:party:unlock-internal";
const DINO_REWARD_KEY = "dali:party:dino-reward";
export const DINO_REWARD_THRESHOLD = 100;

export type PartyEventType =
  | "PARTY_VISIT"
  | "CODE_UNLOCK_SUCCESS"
  | "CODE_UNLOCK_FAILURE"
  | "DINO_REWARD_EARNED"
  | "LOGO_TRAIL_TRIGGERED";

// Fire-and-forget telemetry. Must never throw or block the easter egg.
export function trackPartyEvent(
  eventType: PartyEventType,
  metadata?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/party/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, metadata }),
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Swallow — analytics must never break the page.
  }
}

export function isDinoRewardEarned(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DINO_REWARD_KEY) === "1";
}

export function setDinoRewardEarned(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) window.localStorage.setItem(DINO_REWARD_KEY, "1");
  else window.localStorage.removeItem(DINO_REWARD_KEY);
}

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

const RETRO_EVENT = "dali:party:retro-change";

export function setRetro(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) {
    window.localStorage.setItem(RETRO_KEY, "1");
  } else {
    window.localStorage.removeItem(RETRO_KEY);
    // Also reset the click counter so the user isn't still counting towards /party
    // after explicitly exiting retro mode.
    window.sessionStorage.removeItem(CLICK_KEY);
  }
  document.documentElement.classList.toggle("dali-retro", on);
  window.dispatchEvent(new CustomEvent(RETRO_EVENT, { detail: { on } }));
}

/**
 * React hook that mirrors retro state and rerenders subscribers when it flips.
 * Returns `[isOn, setOn]`. Safe to call from SSR — initial value is `false`.
 */
export function useRetro(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(isRetroOn());
    const onChange = () => setOn(isRetroOn());
    const onStorage = (e: StorageEvent) => {
      if (e.key === RETRO_KEY) setOn(isRetroOn());
    };
    window.addEventListener(RETRO_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(RETRO_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return [on, setRetro];
}

// Returns the new click count. 5 clicks → retro mode + console nudge.
// 10 clicks → redirect to /party (and reset counter).
export function bumpLogoClick(): number {
  if (typeof window === "undefined") return 0;
  const prev = Number(window.sessionStorage.getItem(CLICK_KEY) ?? "0");
  const next = prev + 1;
  if (next === 5) {
    setRetro(true);
    // eslint-disable-next-line no-console
    console.log("%cwhat if you click a few more times?", "color: #d46a6a; font-style: italic");
    window.sessionStorage.setItem(CLICK_KEY, String(next));
    return next;
  }
  if (next >= 10) {
    window.sessionStorage.setItem(CLICK_KEY, "0");
    trackPartyEvent("LOGO_TRAIL_TRIGGERED");
    window.location.assign("/party");
    return 0;
  }
  window.sessionStorage.setItem(CLICK_KEY, String(next));
  return next;
}

export function hydrateRetroClass() {
  if (typeof window === "undefined") return;
  if (isRetroOn()) document.documentElement.classList.add("dali-retro");
}

/** ASCII DALI + nudge; runs once per call (layouts invoke on mount). */
export function logConsoleBootBanner() {
  if (typeof window === "undefined") return;
  const banner = [
    "%c",
    "    ██████╗  █████╗ ██╗     ██╗",
    "    ██╔══██╗██╔══██╗██║     ██║",
    "    ██║  ██║███████║██║     ██║",
    "    ██║  ██║██╔══██║██║     ██║",
    "    ██████╔╝██║  ██║███████╗██║",
    "    ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝",
    "",
    "    Welcome, friend. Have you tried spamming our logo? It's weirdly satisfying.",
    "",
  ].join("\n");
  // eslint-disable-next-line no-console
  console.log(banner, "color: hsl(354 70% 61%); font-family: monospace; line-height: 1;");
}
