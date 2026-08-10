import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocation, useNavigate, useNavigationType } from "react-router";
import {
  navigateHistoryStacks,
  recordNavigation,
  type NavigationHistoryStacks,
} from "~/lib/navigation-history";
import { readTablessPreference } from "~/lib/tabless";
import { desktopVersion } from "~/lib/desktop";

// The arrows are a stand-in for OS/browser chrome tabless mode doesn't have.
// The desktop shell has no such chrome (a bare WKWebView), so it needs them;
// an ordinary browser tab already has its own back/forward buttons. False
// until the client effect resolves so SSR markup matches first paint.
export function useShowTablessHistoryNav(): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(readTablessPreference() && desktopVersion() !== null);
  }, []);
  return show;
}

function currentUrlFromLocation(pathname: string, search: string): string {
  return pathname + search;
}

function useTablessHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const currentUrl = currentUrlFromLocation(location.pathname, location.search);

  const [stacks, setStacks] = useState<NavigationHistoryStacks>({
    backStack: [],
    forwardStack: [],
  });
  const stacksRef = useRef(stacks);
  stacksRef.current = stacks;
  const pendingTargetRef = useRef<string | null>(null);
  const prevUrlRef = useRef(currentUrl);

  useEffect(() => {
    const prev = prevUrlRef.current;
    if (prev === currentUrl) return;

    if (pendingTargetRef.current === currentUrl) {
      pendingTargetRef.current = null;
      prevUrlRef.current = currentUrl;
      return;
    }

    if (navigationType === "REPLACE" || navigationType === "POP") {
      prevUrlRef.current = currentUrl;
      return;
    }

    setStacks((s) => recordNavigation(s, prev, currentUrl));
    prevUrlRef.current = currentUrl;
  }, [currentUrl, navigationType]);

  const go = useCallback(
    (direction: "back" | "forward", steps = 1) => {
      const result = navigateHistoryStacks(
        stacksRef.current,
        currentUrl,
        direction,
        steps,
      );
      if (!result) return;
      pendingTargetRef.current = result.target;
      setStacks(result.stacks);
      navigate(result.target);
    },
    [currentUrl, navigate],
  );

  return {
    backStack: stacks.backStack,
    forwardStack: stacks.forwardStack,
    goBack: () => go("back"),
    goForward: () => go("forward"),
    goHistory: (direction: "back" | "forward", steps: number) => go(direction, steps),
  };
}

// Buttons + right-click history dropdown, with no opinion on the bar that
// hosts them — TablessHistoryNav wraps this in its own full-width bar for
// pages with no subtab row; AreaPillNav/UnderlineTabButtons embed it directly
// in their row for pages that have one, so the arrows don't stack a second
// bar on top of the subtabs.
function HistoryNavButtons() {
  const { backStack, forwardStack, goBack, goForward, goHistory } = useTablessHistory();
  const [historyMenu, setHistoryMenu] = useState<{
    side: "back" | "forward";
    x: number;
    y: number;
  } | null>(null);

  const canBack = backStack.length > 0;
  const canFwd = forwardStack.length > 0;

  const navBtn = (enabled: boolean) =>
    `px-2.5 ${
      enabled
        ? "text-muted-foreground hover:text-foreground hover:bg-muted"
        : "text-muted-foreground/30 cursor-default"
    }`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (!mod && e.altKey && !e.shiftKey) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          goBack();
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          goForward();
          return;
        }
        return;
      }

      if (!mod) return;

      if (!e.altKey && !e.shiftKey && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        if (e.key === "[") goBack();
        else goForward();
      }
    };

    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.button === 3) goBack();
      else goForward();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouse);
    window.addEventListener("auxclick", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("auxclick", onMouse);
    };
  }, [goBack, goForward]);

  useEffect(() => {
    if (!historyMenu) return;
    const dismiss = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest("[data-floating-menu]")) return;
      setHistoryMenu(null);
    };
    window.addEventListener("mousedown", dismiss);
    return () => window.removeEventListener("mousedown", dismiss);
  }, [historyMenu]);

  const stack = historyMenu?.side === "back" ? backStack : forwardStack;
  const entries = stack.slice(-15).reverse();

  return (
    <>
      <button
        type="button"
        disabled={!canBack}
        onClick={() => {
          if (!canBack) return;
          setHistoryMenu(null);
          goBack();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!canBack) return;
          setHistoryMenu((prev) =>
            prev?.side === "back"
              ? null
              : { side: "back", x: e.clientX, y: e.clientY },
          );
        }}
        title={canBack ? "Back (right-click for history)" : "Back"}
        aria-label="Back"
        className={navBtn(canBack)}
      >
        <ChevronLeft className="w-[18px] h-[18px]" />
      </button>
      <button
        type="button"
        disabled={!canFwd}
        onClick={() => {
          if (!canFwd) return;
          setHistoryMenu(null);
          goForward();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!canFwd) return;
          setHistoryMenu((prev) =>
            prev?.side === "forward"
              ? null
              : { side: "forward", x: e.clientX, y: e.clientY },
          );
        }}
        title={canFwd ? "Forward (right-click for history)" : "Forward"}
        aria-label="Forward"
        className={navBtn(canFwd)}
      >
        <ChevronRight className="w-[18px] h-[18px]" />
      </button>

      {historyMenu && entries.length > 0 && (
        <div
          data-floating-menu
          className="fixed z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[260px] max-w-[440px] text-xs"
          style={{ left: historyMenu.x, top: historyMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {entries.map((url, displayIdx) => {
            const steps = displayIdx + 1;
            return (
              <button
                key={`${steps}-${url}`}
                type="button"
                onClick={() => {
                  goHistory(historyMenu.side, steps);
                  setHistoryMenu(null);
                }}
                title={url}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted text-left text-foreground"
              >
                <span className="truncate">{url}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// Standalone bar, for tabless desktop pages with no subtab row of their own
// to sit in. Renders nothing on web (no desktop shell) or in tab mode.
export function TablessHistoryNav() {
  if (!useShowTablessHistoryNav()) return null;
  return (
    <div className="flex items-stretch h-10 bg-section-bg border-b border-border shrink-0">
      <HistoryNavButtons />
    </div>
  );
}

// Embedded in a page's own AreaPillNav/UnderlineTabButtons row so the arrows
// share a line with the subtabs instead of stacking a bar above them.
export function TablessHistoryNavInline() {
  if (!useShowTablessHistoryNav()) return null;
  return <HistoryNavButtons />;
}
