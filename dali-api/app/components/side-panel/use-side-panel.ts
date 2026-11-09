import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useLocation, useSearchParams } from "react-router";
import {
  SIDE_PARAM,
  formatSidePanel,
  getKeptSidePanel,
  getServerKeptSidePanel,
  setKeptSidePanel,
  sidePanelForUrl,
  subscribeKeptSidePanel,
  visibleSidePanel,
  withSidePanel,
  type SidePanel,
} from "~/lib/side-panel";

// Below md the panel covers the page, so Back has to close it.
export function panelCoversPage(): boolean {
  return window.matchMedia?.("(max-width: 767.98px)")?.matches ?? false;
}

export function useVisibleSidePanel(): SidePanel | null {
  const location = useLocation();
  const kept = useSyncExternalStore(subscribeKeptSidePanel, getKeptSidePanel, getServerKeptSidePanel);
  return visibleSidePanel(location, kept);
}

export function useSidePanel() {
  const [params, setParams] = useSearchParams();
  const { key } = useLocation();
  const panel = useVisibleSidePanel();
  const urlNamesPanel = params.has(SIDE_PARAM);
  const open = useCallback(
    (next: SidePanel) => {
      // A router navigation would re-run the page's loaders before the panel could show.
      if (!urlNamesPanel && !panelCoversPage()) {
        setKeptSidePanel(next, key);
        const url = new URL(window.location.href);
        url.searchParams.set(SIDE_PARAM, formatSidePanel(next));
        window.history.replaceState(window.history.state, "", url);
        return;
      }
      setParams(
        (prev) => {
          prev.set(SIDE_PARAM, formatSidePanel(next));
          return prev;
        },
        { replace: !panelCoversPage(), preventScrollReset: true },
      );
    },
    [setParams, urlNamesPanel, key],
  );
  const close = useCallback(() => {
    setKeptSidePanel(null);
    if (urlNamesPanel) {
      setParams(
        (prev) => {
          prev.delete(SIDE_PARAM);
          return prev;
        },
        { replace: true, preventScrollReset: true },
      );
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete(SIDE_PARAM);
    window.history.replaceState(window.history.state, "", url);
  }, [setParams, urlNamesPanel]);
  return { panel, open, close };
}

/**
 * Keeps the panel open as the page beside it changes. Most navigations don't
 * know about `side`, so the panel is held here and written back into the
 * address bar with history.replaceState: going through the router would run
 * every loader on the page a second time.
 */
export function useKeepSidePanel() {
  const location = useLocation();
  useEffect(() => {
    const showing = visibleSidePanel(location, getKeptSidePanel());
    setKeptSidePanel(panelCoversPage() ? null : showing);
    if (!showing || panelCoversPage() || new URLSearchParams(location.search).has(SIDE_PARAM)) return;
    const url = location.pathname + location.search + location.hash;
    window.history.replaceState(window.history.state, "", withSidePanel(url, showing));
  }, [location]);
}

/** Opens a document item in the side panel. */
export function useOpenBeside(): (item: { href: string }) => void {
  const { open } = useSidePanel();
  return useMemo(
    () => (item: { href: string }) => {
      const target = sidePanelForUrl(item.href);
      if (target) open(target);
    },
    [open],
  );
}

/** Option-clicking any link to a document opens it beside instead of navigating. */
export function useAltClickOpensBeside() {
  const { open } = useSidePanel();
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.button !== 0) return;
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const target = sidePanelForUrl(url.pathname);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      openRef.current(target);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}

export function useCarryPageScroll(open: boolean) {
  const pageRef = useRef<HTMLDivElement>(null);
  const windowY = useRef(0);
  const pageY = useRef(0);
  const { pathname } = useLocation();
  const last = useRef({ open: false, pathname });

  useEffect(() => {
    if (open) return;
    const record = () => {
      windowY.current = window.scrollY;
    };
    record();
    window.addEventListener("scroll", record, { passive: true });
    return () => window.removeEventListener("scroll", record);
  }, [open]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    // A tab switch or navigation that also opens or closes the panel restores its own scroll.
    const toggledInPlace = last.current.open !== open && last.current.pathname === pathname;
    last.current = { open, pathname };
    if (!page || panelCoversPage()) return;
    if (open) {
      if (toggledInPlace) page.scrollTop = windowY.current;
      const record = () => {
        pageY.current = page.scrollTop;
      };
      record();
      page.addEventListener("scroll", record, { passive: true });
      return () => page.removeEventListener("scroll", record);
    }
    if (toggledInPlace) window.scrollTo(0, pageY.current);
  }, [open, pathname]);

  return pageRef;
}
