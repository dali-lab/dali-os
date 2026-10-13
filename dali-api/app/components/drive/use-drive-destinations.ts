import { useCallback, useEffect, useRef, useState } from "react";
import type { PickerRows } from "~/components/drive/picker-rows";

export const DRIVE_DESTINATIONS_URL = "/api/drive/destinations";

export async function fetchDriveDestinations(): Promise<PickerRows> {
  const res = await fetch(DRIVE_DESTINATIONS_URL, { credentials: "include" });
  if (!res.ok) throw new Error(`Destinations request failed (${res.status})`);
  const json = (await res.json()) as Partial<PickerRows>;
  return { drives: json.drives ?? [], folders: json.folders ?? [] };
}

const EMPTY: PickerRows = { drives: [], folders: [] };

/** The rows `FolderPicker` offers, fetched on the first `load()` and kept for
 *  the life of the component. `load()` resolves false when the request fails
 *  (and a later call retries). Pass `enabled` (e.g. "the picker is open") to
 *  load as it turns true, with `onError` for a failed load. */
export function useDriveDestinations({
  enabled = false,
  onError,
}: { enabled?: boolean; onError?: () => void } = {}) {
  const [rows, setRows] = useState<PickerRows>(EMPTY);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const inFlight = useRef<Promise<boolean> | null>(null);
  const loaded = useRef(false);

  const load = useCallback((): Promise<boolean> => {
    if (loaded.current) return Promise.resolve(true);
    if (inFlight.current) return inFlight.current;
    setStatus("loading");
    const p = fetchDriveDestinations()
      .then((r) => {
        loaded.current = true;
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
  }, []);

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
