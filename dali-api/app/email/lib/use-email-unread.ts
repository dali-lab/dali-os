import { useEffect, useState } from "react";

const POLL_MS = 120_000;

// Unread total for the sidebar badge. Refreshes on mount, whenever `refreshKey`
// changes (the current path, so reading mail updates it on the way out), when
// the window regains focus, and on a slow poll.
export function useEmailUnread(enabled: boolean, refreshKey: string): number {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch("/api/email/unread", { signal: controller.signal });
        if (res.ok) setTotal(((await res.json()) as { total: number }).total);
      } catch {
        // Aborted or offline — keep the last count.
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    window.addEventListener("focus", load);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [enabled, refreshKey]);

  return enabled ? total : 0;
}
