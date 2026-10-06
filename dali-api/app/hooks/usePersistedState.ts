import { useCallback, useEffect, useRef, useState } from "react";

// Client state that survives navigation, keyed in localStorage. Renders with
// the fallback first and hydrates after mount so server and client markup
// match; a key change re-hydrates (or resets to the fallback) so one hook can
// back per-record state such as filters per hiring cycle. Storage failures
// (private windows, quota) are swallowed: the state just stops persisting.
export function usePersistedState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T = (v): v is T => v != null,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(fallback);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    if (typeof window === "undefined") return;
    let next = fallbackRef.current;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) {
        const parsed: unknown = JSON.parse(raw);
        if (isValid(parsed)) next = parsed;
      }
    } catch {
      // Unreadable storage or corrupt JSON: fall back.
    }
    setValue(next);
    // isValid is a stable guard by convention; re-running on it would thrash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Storage unavailable: keep the in-memory value.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}
