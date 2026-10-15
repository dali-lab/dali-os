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

/** The rows `FolderPicker` offers, fetched on the first `load()` and kept until
 *  `movingIds` changes (the server drops destinations those pages may not move to). `load()` resolves false when the request fails
 *  (and a later call retries). Pass `enabled` (e.g. "the picker is open") to
 *  load as it turns true, with `onError` for a failed load. */
export function useDriveDestinations({
  enabled = false,
  onError,
  movingIds,
}: { enabled?: boolean; onError?: () => void; movingIds?: string[] } = {}) {
  const [rows, setRows] = useState<PickerRows>(EMPTY);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const inFlight = useRef<Promise<boolean> | null>(null);
  const loadedKey = useRef<string | null>(null);
  const key = (movingIds ?? []).join(",");

  const load = useCallback((): Promise<boolean> => {
    if (loadedKey.current === key) return Promise.resolve(true);
    if (inFlight.current) return inFlight.current;
    setStatus("loading");
    const p = fetchDriveDestinations(key ? key.split(",") : [])
      .then((r) => {
        loadedKey.current = key;
        setRows(r);
        setStatus("ready");
        return true;
      })
      .catch(() => {
        setStatus("error");
        return false;
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = p;
    return p;
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
