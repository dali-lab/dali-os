import { useEffect, useRef, useState } from "react";

const POLL_MS = 120_000;
export const THROTTLE_MS = 60_000;

let lastFetchAt = 0;
let lastTotal = 0;
// Stays set until a fetch lands, so an aborted refresh carries to the next load.
let stale = false;

export function resetEmailUnreadCache(): void {
  lastFetchAt = 0;
  lastTotal = 0;
  stale = false;
}

export function markEmailUnreadStale(): void {
  stale = true;
}

function isUnderEmail(key: string): boolean {
  const path = key.split(/[?#]/)[0];
  return path === "/email" || path.startsWith("/email/");
}

export function navigatedFromEmail(prevKey: string | null, key: string): boolean {
  return prevKey !== null && isUnderEmail(prevKey) && !isUnderEmail(key);
}

export async function loadEmailUnread(opts: { signal?: AbortSignal }): Promise<number> {
  if (!stale && Date.now() - lastFetchAt < THROTTLE_MS) return lastTotal;
  try {
    const res = await fetch("/api/email/unread", { signal: opts.signal });
    if (!res.ok) return lastTotal;
    const { total } = (await res.json()) as { total: number };
    if (opts.signal?.aborted) return lastTotal;
    lastTotal = total;
    lastFetchAt = Date.now();
    stale = false;
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
    const load = () =>
      loadEmailUnread({ signal: controller.signal }).then((t) => {
        if (!controller.signal.aborted) setTotal(t);
      });
    if (navigatedFromEmail(prevKey.current, refreshKey)) markEmailUnreadStale();
    load();
    prevKey.current = refreshKey;
    const timer = setInterval(load, POLL_MS);
    window.addEventListener("focus", load);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [refreshKey]);

  return total;
}
