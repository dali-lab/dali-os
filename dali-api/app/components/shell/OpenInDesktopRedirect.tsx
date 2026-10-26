import { useEffect, useState } from "react";
import { Modal } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { isBrowserDesktopCandidate } from "~/lib/desktop-candidate";
import { readOpenInAppCookie } from "~/lib/open-in-app-pref";
import {
  currentPagePath,
  isOpenInDesktopExcluded,
  openInDesktopApp,
  setStayInBrowserThisTab,
  stayInBrowserThisTab,
} from "~/lib/open-in-desktop";

type State = "idle" | "opening" | "fallback";

export function OpenInDesktopRedirect() {
  const flag = useFeatureFlag("desktop-tabs");
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    if (!flag || !isBrowserDesktopCandidate()) return;
    if (!readOpenInAppCookie() || stayInBrowserThisTab()) return;
    const { pathname, search } = window.location;
    if (isOpenInDesktopExcluded(pathname, search)) return;
    setState("opening");
    return openInDesktopApp(currentPagePath(), {
      onFallback: () => setState("fallback"),
      onOpened: () => setState("idle"),
    });
  }, [flag]);

  function stay() {
    setStayInBrowserThisTab();
    setState("idle");
  }

  return (
    <Modal open={state !== "idle"} onClose={stay} labelledBy="open-in-desktop-title">
      <h2 id="open-in-desktop-title" className="font-heading text-xl font-medium text-foreground">
        {state === "fallback" ? "The desktop app didn't open." : "Opening in DALI OS…"}
      </h2>
      <div className="mt-6 flex justify-end gap-2">
        {state === "fallback" && (
          <a href="/download" className={buttonClasses("primary", "sm")}>
            Download
          </a>
        )}
        <button type="button" onClick={stay} className={buttonClasses("secondary", "sm")}>
          Stay in browser
        </button>
      </div>
    </Modal>
  );
}
