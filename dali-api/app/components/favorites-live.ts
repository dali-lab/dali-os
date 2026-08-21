import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { FavoritePage } from "~/lib/user-pages.server";

// Same-window event meaning "a star just landed, the shell's list is stale".
// The shell relays the cross-frame postMessage of the same name into it, so a
// star clicked inside a workspace iframe reaches the header — see useShellNav.
export const FAVORITES_CHANGED_EVENT = "dali:favoritesChanged";

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

/**
 * Shell side: the starred list the header draws, kept current without a reload.
 *
 * Seeded from the layout loader and re-read from `/api/favorites` when a star
 * lands. It re-reads rather than patching the list client-side because the
 * server decides both the order (most recently pinned first) and each row's
 * icon, which a route favorite only resolves by looking up its destination.
 */
export function useLiveFavorites(initial: FavoritePage[]): FavoritePage[] {
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

  return favorites;
}
