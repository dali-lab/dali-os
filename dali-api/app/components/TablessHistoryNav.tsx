import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocation, useNavigate, useNavigationType } from "react-router";
import {
  getSnapshot,
  observeNavigation,
  stepHistory,
  subscribe,
} from "~/lib/navigation-history-store";
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

// Feed every location change into the shared history store. Lives on the
// always-mounted shell (Layout) rather than the arrow component, so a
// navigation is recorded exactly once even when the arrow host is remounting
// across the transition — and still recorded when no arrow host is rendered.
export function useRecordTablessHistory() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const currentUrl = currentUrlFromLocation(location.pathname, location.search);
  useEffect(() => {
    observeNavigation(currentUrl, navigationType);
  }, [currentUrl, navigationType]);
}

function useTablessHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentUrl = currentUrlFromLocation(location.pathname, location.search);

  const stacks = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const go = useCallback(
    (direction: "back" | "forward", steps = 1) => {
      const target = stepHistory(currentUrl, direction, steps);
      if (target === null) return;
      navigate(target);
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

// Back/forward shortcuts (⌘[ / ⌘], ⌥← / ⌥→, mouse buttons 4/5). Mounted by the
// always-present shell rather than the arrows, so they keep working in focus
// mode, where the top bar (and the arrows in it) is unmounted.
export function useTablessHistoryShortcuts(enabled: boolean) {
  const { goBack, goForward } = useTablessHistory();

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, goBack, goForward]);
}

// Back/forward buttons + right-click history dropdown, sitting at the left of
// the os top bar ahead of the favorites star. Renders nothing on web (no
// desktop shell) or in tab mode.
export function TablessHistoryNav() {
  if (!useShowTablessHistoryNav()) return null;
  return <HistoryNavButtons />;
}

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
    `flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
      enabled
        ? "text-os-muted hover:text-foreground hover:bg-os-card"
        : "text-os-muted/30 cursor-default"
    }`;

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
    <div className="flex flex-shrink-0 items-center gap-1">
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
        <ChevronLeft className="h-5 w-5" />
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
        <ChevronRight className="h-5 w-5" />
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
    </div>
  );
}
