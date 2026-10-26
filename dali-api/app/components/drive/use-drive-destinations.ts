import { useCallback, useEffect, useRef, useState } from "react";
import type { PickerRows } from "~/components/drive/picker-rows";

export const DRIVE_DESTINATIONS_URL = "/api/drive/destinations";

export async function fetchDriveDestinations(movingIds: string[] = []): Promise<PickerRows> {
  const url = movingIds.length
    ? `${DRIVE_DESTINATIONS_URL}?moving=${encodeURIComponent(movingIds.join(","))}`
    : DRIVE_DESTINATIONS_URL;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Destinations request failed (${res.status})`);
  const json = (await res.json()) as Partial<PickerRows>;
  return { drives: json.drives ?? [], folders: json.folders ?? [] };
}

const EMPTY: PickerRows = { drives: [], folders: [] };

// Rows seen this session, keyed by the pages being moved (the server drops
// destinations those pages may not move to). Shown at once on any later open
// and refreshed behind it once they are older than FRESH_MS.
const FRESH_MS = 10_000;
const MAX_CACHED_KEYS = 20;
const cache = new Map<string, { rows: PickerRows; at: number }>();
const pending = new Map<string, Promise<PickerRows>>();

function fetchShared(key: string): Promise<PickerRows> {
  const existing = pending.get(key);
  if (existing) return existing;
  const p = fetchDriveDestinations(key ? key.split(",") : [])
    .then((rows) => {
      cache.delete(key);
      cache.set(key, { rows, at: Date.now() });
      if (cache.size > MAX_CACHED_KEYS) cache.delete(cache.keys().next().value as string);
      return rows;
    })
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

export function resetDriveDestinationsForTests(): void {
  cache.clear();
  pending.clear();
}

/** The rows `FolderPicker` offers. `load()` resolves true at once when this
 *  `movingIds` set has been seen this session (refreshing in the background if
 *  stale) and false when a first request fails (a later call retries). Pass
 *  `enabled` (e.g. "the picker is open") to load as it turns true, with
 *  `onError` for a failed load. */
export function useDriveDestinations({
  enabled = false,
  onError,
  movingIds,
}: { enabled?: boolean; onError?: () => void; movingIds?: string[] } = {}) {
  const key = (movingIds ?? []).join(",");
  const [rows, setRows] = useState<PickerRows>(() => cache.get(key)?.rows ?? EMPTY);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(() =>
    cache.has(key) ? "ready" : "idle",
  );
  const refreshedFor = useRef<string | null>(null);

  const load = useCallback((): Promise<boolean> => {
    const hit = cache.get(key);
    if (hit) {
      setRows(hit.rows);
      setStatus("ready");
      if (refreshedFor.current !== key && Date.now() - hit.at >= FRESH_MS) {
        refreshedFor.current = key;
        fetchShared(key).then(setRows, () => {});
      }
      return Promise.resolve(true);
    }
    setStatus("loading");
    return fetchShared(key).then(
      (r) => {
        refreshedFor.current = key;
        setRows(r);
        setStatus("ready");
        return true;
      },
      () => {
        setStatus("error");
        return false;
      },
    );
  }, [key]);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    if (!enabled) return;
    void load().then((ok) => {
      if (!ok) onErrorRef.current?.();
    });
  }, [enabled, load]);

  return { rows, status, load };
}
