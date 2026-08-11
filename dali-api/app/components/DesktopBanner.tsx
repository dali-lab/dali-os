import { useState, useEffect, useRef } from "react";
import { Download, X } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { useFeatureFlag } from "~/components/FeatureFlags";

const DISMISS_KEY = "dali:desktop-banner:dismissed";

type State = "hidden" | "visible" | "trying" | "fallback";

export function DesktopBanner() {
  const enabled = useFeatureFlag("desktop-app");
  const [state, setState] = useState<State>("hidden");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if ("__TAURI__" in window) return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      return;
    }
    setState("visible");
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled]);

  function openInApp() {
    setState("trying");
    window.location.href = "dalios://open";
    timerRef.current = setTimeout(() => setState("fallback"), 1500);
  }

  function dismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setState("hidden");
  }

  if (state === "hidden") return null;

  return (
    <div className="flex-none bg-card border-b border-border px-4 py-2 flex items-center gap-2">
      <span className="text-sm text-muted-foreground flex-1 min-w-0">
        {state === "trying" ? "Opening…" : state === "fallback" ? "App not installed?" : null}
      </span>
      {state === "visible" && (
        <button
          type="button"
          onClick={openInApp}
          className={buttonClasses("primary", "sm")}
        >
          Open in app
        </button>
      )}
      {state === "fallback" && (
        <a
          href="/download"
          className={buttonClasses("primary", "sm")}
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </a>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="p-1 text-muted-foreground hover:text-foreground transition"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
