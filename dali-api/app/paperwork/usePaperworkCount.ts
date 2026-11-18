import { useEffect } from "react";
import { useFetcher } from "react-router";

export function usePaperworkCount(enabled: boolean, refreshKey: string): number {
  const fetcher = useFetcher<{ count?: number }>({ key: "paperwork-count" });
  useEffect(() => {
    if (enabled) fetcher.load("/api/paperwork/count");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refreshKey]);
  return enabled ? (fetcher.data?.count ?? 0) : 0;
}
