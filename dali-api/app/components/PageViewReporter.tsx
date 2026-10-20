import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import {
  TICK_MS,
  advanceTimer,
  isCounting,
  pendingFlush,
  startTimer,
  type ViewTimer,
} from "~/lib/pageview-timer";

const ENDPOINT = "/api/analytics/pageview";

function beacon(payload: object): void {
  const body = JSON.stringify(payload);
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
  } catch {
    // fall through to fetch
  }
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

function frameRendered(): boolean | null {
  try {
    const el = window.frameElement as HTMLElement | null;
    if (!el) return null;
    if (typeof el.checkVisibility === "function") return el.checkVisibility();
    return el.getClientRects().length > 0;
  } catch {
    return null;
  }
}

function counting(): boolean {
  return isCounting({
    documentVisible: document.visibilityState === "visible",
    frameRendered: frameRendered(),
  });
}

type ActiveView = { id: string; timer: ViewTimer };

export function PageViewReporter({ enabled }: { enabled: boolean }) {
  const { pathname } = useLocation();
  const previousPath = useRef<string | null>(null);
  const active = useRef<ActiveView | null>(null);

  function flush() {
    const view = active.current;
    if (!view) return;
    view.timer = advanceTimer(view.timer, Date.now(), counting());
    const pending = pendingFlush(view.timer);
    if (!pending) return;
    view.timer = pending.next;
    beacon({ type: "duration", id: view.id, durationMs: pending.durationMs });
  }

  useEffect(() => {
    if (!enabled) return;

    const id = crypto.randomUUID();
    active.current = { id, timer: startTimer(Date.now(), counting()) };
    beacon({
      type: "view",
      id,
      path: pathname,
      referrer: previousPath.current ?? (document.referrer || undefined),
    });
    previousPath.current = pathname;

    const ticker = window.setInterval(() => {
      const view = active.current;
      if (view) view.timer = advanceTimer(view.timer, Date.now(), counting());
    }, TICK_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);

    return () => {
      window.clearInterval(ticker);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
      active.current = null;
    };
  }, [pathname, enabled]);

  return null;
}
