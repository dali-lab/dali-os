import { useEffect } from "react";

// Mounts global listeners for uncaught errors and unhandled promise rejections,
// and beacons each one to /api/analytics/error. Designed to be cheap: dedupes
// repeated messages within the same page (a render loop logs once, not 60×/s).

const SEEN = new Set<string>();

function beacon(payload: {
  message: string;
  path: string;
  stack?: string;
}): void {
  // Dedupe by message + first line of stack so a render loop doesn't flood.
  const key = `${payload.message}|${(payload.stack ?? "").split("\n")[0]}`;
  if (SEEN.has(key)) return;
  SEEN.add(key);

  const body = JSON.stringify(payload);
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/analytics/error", blob);
      return;
    }
  } catch {
    // fall through to fetch
  }
  // keepalive lets the request outlive the page on browsers without sendBeacon.
  fetch("/api/analytics/error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function AnalyticsErrorReporter() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    function onError(event: ErrorEvent) {
      beacon({
        message: event.message || "Uncaught error",
        path: window.location.pathname,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    }
    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Unhandled promise rejection";
      const stack = reason instanceof Error ? reason.stack : undefined;
      beacon({
        message,
        path: window.location.pathname,
        stack,
      });
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}

// Helper for ErrorBoundary callers to fire a beacon for a render-time crash
// that React handed them (these don't bubble up to window.onerror).
export function reportBoundaryError(error: unknown, path: string) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Render error";
  const stack = error instanceof Error ? error.stack : undefined;
  beacon({ message, path, stack });
}
