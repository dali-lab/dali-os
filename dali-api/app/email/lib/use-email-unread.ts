import { useEffect, useRef, useState } from "react";

const POLL_MS = 120_000;
export const THROTTLE_MS = 60_000;

let lastFetchAt = 0;
let lastTotal = 0;

export function resetEmailUnreadCache(): void {
  lastFetchAt = 0;
  lastTotal = 0;
}

export function navigatedFromEmail(prevKey: string | null, key: string): boolean {
  return prevKey !== null && prevKey !== key && prevKey.startsWith("/email");
}

export async function loadEmailUnread(opts: {
  signal?: AbortSignal;
  force?: boolean;
}): Promise<number> {
  if (!opts.force && Date.now() - lastFetchAt < THROTTLE_MS) return lastTotal;
  try {
    const res = await fetch("/api/email/unread", { signal: opts.signal });
    if (!res.ok) return lastTotal;
    const { total } = (await res.json()) as { total: number };
    if (opts.signal?.aborted) return lastTotal;
    lastTotal = total;
    lastFetchAt = Date.now();
  } catch {
    // Aborted or offline: keep the last count.
  }
  return lastTotal;
}

// Unread total for the sidebar badge. `refreshKey` is the current path;
// navigating away from a page under /email bypasses the throttle so the badge
// reflects mail just read.
export function useEmailUnread(refreshKey: string): number {
  const [total, setTotal] = useState(lastTotal);
  const prevKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = (force = false) =>
      loadEmailUnread({ signal: controller.signal, force }).then((t) => {
        if (!controller.signal.aborted) setTotal(t);
      });
    load(navigatedFromEmail(prevKey.current, refreshKey));
    prevKey.current = refreshKey;
    const timer = setInterval(() => load(), POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshKey]);

  return total;
}
