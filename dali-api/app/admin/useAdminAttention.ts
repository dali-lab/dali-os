import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { AdminAlertKey } from "~/admin/adminNav";

/** Sidebar counts for the Admin sections. Fetched only while `enabled`, and again on each `refreshKey`. */
export function useAdminAttention(enabled: boolean, refreshKey: string): Partial<Record<AdminAlertKey, number>> {
  const fetcher = useFetcher<{ counts?: Record<AdminAlertKey, number> }>({ key: "admin-attention" });
  useEffect(() => {
    if (enabled) fetcher.load("/api/admin/attention");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refreshKey]);
  return enabled ? (fetcher.data?.counts ?? {}) : {};
}
