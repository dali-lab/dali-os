import { useCallback, useEffect, useRef, useState } from "react";
import { readStorage, writeStorage } from "~/lib/safe-storage";

export type PersistCodec<T> = {
  parse: (raw: string) => unknown;
  serialize: (value: T) => string | null;
};

export const jsonCodec: PersistCodec<unknown> = { parse: JSON.parse, serialize: JSON.stringify };

// A null serialization removes the key, so "1"-or-absent flags keep their old format.
export const flagCodec: PersistCodec<boolean> = {
  parse: (raw) => raw === "1",
  serialize: (value) => (value ? "1" : null),
};

export const stringSetCodec: PersistCodec<Set<string>> = {
  parse: (raw) => {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === "string")) : null;
  },
  serialize: (value) => JSON.stringify([...value]),
};

export function listCodec<T extends string>(guard: (v: unknown) => v is T): PersistCodec<T[]> {
  return {
    parse: (raw) => {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(guard) : null;
    },
    serialize: (value) => JSON.stringify(value),
  };
}

export const isList = <T,>(v: unknown): v is T[] => Array.isArray(v);

// Client state that survives navigation, keyed in localStorage. Renders with
// the fallback first and hydrates after mount so server and client markup
// match; a key change re-hydrates (or resets to the fallback) so one hook can
// back per-record state such as filters per hiring cycle. Storage failures
// (private windows, quota) are swallowed: the state just stops persisting.
export function usePersistedState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T = (v): v is T => v != null,
  codec: PersistCodec<T> = jsonCodec as PersistCodec<T>,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(fallback);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const codecRef = useRef(codec);
  codecRef.current = codec;

  useEffect(() => {
    if (typeof window === "undefined") return;
    let next = fallbackRef.current;
    try {
      const raw = readStorage(key);
      if (raw != null) {
        const parsed = codecRef.current.parse(raw);
        if (isValid(parsed)) next = parsed;
      }
    } catch {
      // Corrupt JSON: fall back.
    }
    setValue(next);
    // isValid is a stable guard by convention; re-running on it would thrash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        writeStorage(key, codecRef.current.serialize(resolved));
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}
