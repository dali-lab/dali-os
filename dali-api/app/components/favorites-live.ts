import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useFetcher } from "react-router";
import { isNavbarRoute } from "~/lib/navbar-routes";
import type { FavoritePage } from "~/lib/user-pages.server";

// Same-window event meaning "a star just landed, the shell's list is stale".
// The shell relays the cross-frame postMessage of the same name into it, so a
// star clicked inside a workspace iframe reaches the header — see useShellNav.
export const FAVORITES_CHANGED_EVENT = "dali:favoritesChanged";

// Cancelable: the shell calls preventDefault when it handles Cmd/Ctrl+D, so the
// key's default (the browser's bookmark dialog) is only suppressed when the
// favorites bar is actually on.
export const TOGGLE_FAVORITE_EVENT = "dali:toggleFavorite";

/** Page side: call after a favorite write succeeds. */
export function notifyFavoritesChanged() {
  if (typeof window === "undefined") return;
  if (window.self !== window.top) {
    window.parent.postMessage(
      { type: FAVORITES_CHANGED_EVENT },
      window.location.origin,
    );
  } else {
    window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT));
  }
}

export type FavoriteTarget = { pageId: string } | { href: string; label: string };

/**
 * The one favorite write. Resolves true once the server accepted it, and tells
 * the shell so the topbar list refreshes; false (nothing notified) otherwise.
 */
export async function setFavoriteRequest(
  target: FavoriteTarget,
  favorited: boolean,
): Promise<boolean> {
  const [url, body] =
    "pageId" in target
      ? [`/api/pages/${target.pageId}/favorite`, { favorited }]
      : ["/api/favorites/route", { href: target.href, label: target.label, favorited }];
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    notifyFavoritesChanged();
    return true;
  } catch {
    return false;
  }
}

/** Persist the bar's order. True once the server accepted it. */
export async function saveFavoritesOrder(ids: string[]): Promise<boolean> {
  try {
    const res = await fetch("/api/favorites/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ids }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** For callers that own their own busy/error state (row menus that revalidate). */
export function setPageFavorite(pageId: string, favorited: boolean): Promise<boolean> {
  return setFavoriteRequest({ pageId }, favorited);
}

/**
 * Optimistic star toggle shared by every star control. Flips immediately,
 * reverts if the write fails, and notifies the shell on success.
 */
export function useFavoriteToggle(
  target: FavoriteTarget,
  initial: boolean,
  onToggled?: (favorited: boolean) => void,
) {
  const [favorited, setFavorited] = useState(initial);
  const [busy, setBusy] = useState(false);
  const targetRef = useRef(target);
  targetRef.current = target;
  const onToggledRef = useRef(onToggled);
  onToggledRef.current = onToggled;

  const toggle = useCallback(async () => {
    const next = !favorited;
    setFavorited(next);
    setBusy(true);
    const ok = await setFavoriteRequest(targetRef.current, next);
    if (ok) onToggledRef.current?.(next);
    else setFavorited(!next);
    setBusy(false);
  }, [favorited]);

  return { favorited, setFavorited, busy, toggle };
}

/**
 * Shell side: the starred list the header draws, kept current without a reload.
 *
 * Seeded from the layout loader and re-read from `/api/favorites` when a star
 * lands. It re-reads rather than patching the list client-side because the
 * server decides both the order and each row's icon, which a route favorite
 * only resolves by looking up its destination. The setter exists for local
 * drag-reorders, which the caller persists itself.
 */
export function useLiveFavorites(
  initial: FavoritePage[],
): [FavoritePage[], Dispatch<SetStateAction<FavoritePage[]>>] {
  const fetcher = useFetcher<{ favorites: FavoritePage[] }>();
  const [favorites, setFavorites] = useState(initial);

  // A navigation re-runs the layout loader, which is at least as fresh as
  // anything fetched earlier — and is the only thing that reflects a star set
  // in another window.
  useEffect(() => setFavorites(initial), [initial]);

  useEffect(() => {
    if (fetcher.data?.favorites) setFavorites(fetcher.data.favorites);
  }, [fetcher.data]);

  const load = fetcher.load;
  useEffect(() => {
    const onChanged = () => load("/api/favorites");
    window.addEventListener(FAVORITES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(FAVORITES_CHANGED_EVENT, onChanged);
  }, [load]);

  return [favorites, setFavorites];
}

/**
 * The topbar star: whether the page at `url` is favorited, kept in step with
 * stars set elsewhere. Pages (documents, forms, whiteboards) and plain routes
 * share one endpoint, which classifies the URL server-side.
 */
export function useCurrentPageFavorite(url: string | null, label: string, enabled: boolean) {
  const toggle = useFavoriteToggle({ href: url ?? "", label }, false);
  const { setFavorited } = toggle;
  const inSidebar = url !== null && isNavbarRoute(url);

  useEffect(() => {
    if (!enabled || !url || inSidebar) {
      setFavorited(false);
      return;
    }
    let live = true;
    const read = () =>
      fetch(`/api/favorites/route?href=${encodeURIComponent(url)}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (live && d) setFavorited(!!d.favorited);
        })
        .catch(() => {});
    void read();
    window.addEventListener(FAVORITES_CHANGED_EVENT, read);
    return () => {
      live = false;
      window.removeEventListener(FAVORITES_CHANGED_EVENT, read);
    };
  }, [enabled, url, inSidebar, setFavorited]);

  return { ...toggle, inSidebar, canToggle: enabled && !!url && !inSidebar && !toggle.busy };
}
