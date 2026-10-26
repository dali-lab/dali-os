import { useState, useEffect, useRef } from "react";
import { Download, X } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { isBrowserDesktopCandidate } from "~/lib/desktop-candidate";
import { useFeatureFlag } from "~/components/FeatureFlags";

const DISMISS_KEY = "dali:desktop-banner:dismissed";

type State = "hidden" | "visible" | "trying" | "fallback";

export function DesktopBanner() {
  const [state, setState] = useState<State>("hidden");
  const explain = useFeatureFlag("desktop-tabs");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isBrowserDesktopCandidate()) return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      return;
    }
    setState("visible");
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function openInApp() {
    setState("trying");
    // Carry the current route so the app lands on this page, not its home
    // screen. The Rust handler prepends the prod origin to a relative path
    // (see desktop/src-tauri/src/deeplink.rs).
    const target =
      window.location.pathname + window.location.search + window.location.hash;
    window.location.href = `dalios://open?link=${encodeURIComponent(target)}`;
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
        {state === "trying"
          ? "Opening…"
          : state === "fallback"
            ? "App not installed?"
            : explain
              ? "Get the DALI OS desktop app for tabs and native notifications."
              : null}
      </span>
      {state === "visible" && explain && (
        <a href="/download" className={buttonClasses("primary", "sm")}>
          <Download className="w-3.5 h-3.5" />
          Download
        </a>
      )}
      {state === "visible" && (
        <button
          type="button"
          onClick={openInApp}
          className={buttonClasses(explain ? "secondary" : "primary", "sm")}
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
