import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

// A filter value kept in one search param, so a filtered view survives reload
// and the back button and can be shared as a link. Writes replace the history
// entry: filters are a view of the page, not steps a user navigates through.
// With debounceMs the returned value tracks every keystroke while the URL
// waits until typing stops.
export function useSearchParamState(
  key: string,
  { debounceMs = 0 }: { debounceMs?: number } = {},
): [string, (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlValue = searchParams.get(key) ?? "";
  const [value, setValue] = useState(urlValue);
  // Our writes the URL hasn't caught up to yet. The URL landing on one of them
  // is our own echo and must not overwrite keystrokes typed since.
  const pending = useRef<string[]>([]);
  const seen = useRef(urlValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (urlValue === seen.current) return;
    seen.current = urlValue;
    const echo = pending.current.indexOf(urlValue);
    if (echo >= 0) {
      pending.current = pending.current.slice(echo + 1);
      return;
    }
    pending.current = [];
    if (timer.current) clearTimeout(timer.current);
    setValue(urlValue);
  }, [urlValue]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const write = useCallback(
    (next: string) => {
      if (pending.current.length === 0 && next === seen.current) return;
      pending.current.push(next);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === "") params.delete(key);
          else params.set(key, next);
          return params;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [key, setSearchParams],
  );

  const set = useCallback(
    (next: string) => {
      setValue(next);
      if (timer.current) clearTimeout(timer.current);
      if (debounceMs > 0) timer.current = setTimeout(() => write(next), debounceMs);
      else write(next);
    },
    [debounceMs, write],
  );

  return [value, set];
}

// A tab, segmented view or single-choice filter kept in one search param. An
// unknown value reads as the default, and the default stays out of the URL.
export function useSearchParamChoice<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [raw, setRaw] = useSearchParamState(key);
  const value = (choices as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback((next: T) => setRaw(next === fallback ? "" : next), [fallback, setRaw]);
  return [value, set];
}
