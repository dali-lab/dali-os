import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { useToast } from "~/components/ui/toast";
import { isBrowserDesktopCandidate } from "~/lib/desktop-candidate";

export const DESKTOP_HINT_SESSION_KEY = "dali:desktop-hint:shown";
export const DESKTOP_HINT_DISMISS_ACTION = "/api/desktop-hint/dismiss";

function alreadyShownThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(DESKTOP_HINT_SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

function markShown() {
  try {
    window.sessionStorage.setItem(DESKTOP_HINT_SESSION_KEY, "1");
  } catch {
    // ignore
  }
}

function internalLinkFrom(target: EventTarget | null): HTMLAnchorElement | null {
  const el = target instanceof Element ? target.closest("a[href]") : null;
  if (!el) return null;
  const a = el as HTMLAnchorElement;
  return a.origin === window.location.origin ? a : null;
}

export function useDesktopHint({ enabled, dismissed }: { enabled: boolean; dismissed: boolean }) {
  const toast = useToast();
  const fetcher = useFetcher();
  const submit = useRef(fetcher.submit);
  submit.current = fetcher.submit;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!enabled || dismissed) return;
    function onClick(e: MouseEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (!isBrowserDesktopCandidate()) return;
      if (!internalLinkFrom(e.target)) return;
      if (alreadyShownThisSession()) return;
      markShown();
      toastRef.current.info("Tabs work in the desktop app.", {
        duration: 10000,
        actions: [
          {
            label: "Download",
            onClick: () => window.open("/download", "_blank", "noopener"),
          },
          {
            label: "Don't show again",
            onClick: () =>
              submit.current({}, { method: "post", action: DESKTOP_HINT_DISMISS_ACTION }),
          },
        ],
      });
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [enabled, dismissed]);
}
