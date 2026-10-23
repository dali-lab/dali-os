import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { SIDE_PARAM, formatSidePanel, parseSidePanel, type SidePanel } from "~/lib/side-panel";

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

/**
 * Open a document beside the current page: the side panel behind
 * `desktop-tabs`, otherwise the caller's own fallback.
 */
export function useOpenDocumentBeside(
  fallback: (pageId: string, label: string) => void,
): (pageId: string, label: string) => void {
  const enabled = useFeatureFlag("desktop-tabs");
  const { open } = useSidePanel();
  return useCallback(
    (pageId: string, label: string) => {
      if (enabled) open({ type: "doc", id: pageId });
      else fallback(pageId, label);
    },
    [enabled, open, fallback],
  );
}
