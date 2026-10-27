import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { SIDE_PARAM, formatSidePanel, parseSidePanel, sidePanelForUrl, type SidePanel } from "~/lib/side-panel";

export function useSidePanel() {
  const [params, setParams] = useSearchParams();
  const panel = parseSidePanel(params.get(SIDE_PARAM));
  const open = useCallback(
    (next: SidePanel) =>
      setParams(
        (prev) => {
          prev.set(SIDE_PARAM, formatSidePanel(next));
          return prev;
        },
        { preventScrollReset: true },
      ),
    [setParams],
  );
  const close = useCallback(
    () =>
      setParams(
        (prev) => {
          prev.delete(SIDE_PARAM);
          return prev;
        },
        { replace: true, preventScrollReset: true },
      ),
    [setParams],
  );
  return { panel, open, close };
}

/** Opens a document item in the side panel behind `desktop-tabs`; undefined when the flag is off. */
export function useOpenBeside(): ((item: { href: string }) => void) | undefined {
  const enabled = useFeatureFlag("desktop-tabs");
  const { open } = useSidePanel();
  return useMemo(() => {
    if (!enabled) return undefined;
    return (item: { href: string }) => {
      const target = sidePanelForUrl(item.href);
      if (target) open(target);
    };
  }, [enabled, open]);
}

/** Option-clicking any link to a document opens it beside instead of navigating. */
export function useAltClickOpensBeside() {
  const enabled = useFeatureFlag("desktop-tabs");
  const { open } = useSidePanel();
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);
}
