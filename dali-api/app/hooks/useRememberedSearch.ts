import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";

// `embed` marks the tabbed shell's iframe, not part of the view.
const SHELL_PARAMS = ["embed"];

const viewOf = (params: URLSearchParams, skip: readonly string[]) => {
  const view = new URLSearchParams(params);
  for (const key of skip) view.delete(key);
  return view;
};

// Reopens a list page on its last view when it's opened bare (from the sidebar
// or a breadcrumb), and remembers every change to that view. The URL stays the
// source of truth; this browser just keeps a copy. `transient` params (an open
// card, a settings modal) are neither remembered nor count as a view. Storage
// failures are swallowed: the page simply opens bare.
export function useRememberedSearch(
  storageKey: string,
  { transient = [] }: { transient?: readonly string[] } = {},
) {
  const [params, setParams] = useSearchParams();
  const restored = useRef(false);
  const skip = [...SHELL_PARAMS, ...transient];

  useEffect(() => {
    restored.current = true;
    if ([...viewOf(params, skip)].length > 0) return;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(storageKey);
    } catch {
      return;
    }
    if (!saved) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(saved);
        for (const key of skip) for (const v of prev.getAll(key)) next.append(key, v);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
    // Restores once per mount; later param changes are the user's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    const view = viewOf(params, skip).toString();
    try {
      if (view) window.localStorage.setItem(storageKey, view);
      else window.localStorage.removeItem(storageKey);
    } catch {
      // Unwritable storage: the view just isn't remembered.
    }
    // `skip` is rebuilt each render from a constant list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, storageKey]);
}
