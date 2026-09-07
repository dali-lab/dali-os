import { useEffect, useState } from "react";

/**
 * SSR-safe `window.matchMedia` subscription.
 *
 * Returns `false` on the server and on the first client render (avoids a
 * hydration mismatch), then synchronises to the actual match state in a
 * `useEffect` and re-renders on every `change` event.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    // Sync immediately so we flip on the first paint after mount.
    setMatches(mql.matches);

    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/**
 * Returns `true` when the viewport is below Tailwind's `md` breakpoint
 * (i.e. ≤767px — a phone or narrow tablet).  Stays `false` on the server
 * and on first client render so SSR output matches.
 *
 * Prefer the server-side UA detection in `lib/tabless.ts` for shell-level
 * decisions that must avoid a layout flash; use this hook for in-component
 * behavioural tweaks that only matter post-hydration.
 */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
