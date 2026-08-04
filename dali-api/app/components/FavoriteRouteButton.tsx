import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Star } from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";

// Stars the page you're currently on — for destinations that aren't documents:
// a project hub, any subtab. Rides the right edge of the subtab bars next to
// the Docs button, so every tabbed surface gets it from one place.
//
// The current URL is read from the router rather than passed in, so callers
// only supply a label. Search params are included: subtabs are usually ?tab=…,
// and dropping them would make every tab of a page the same favourite.
export function FavoriteRouteButton({
  label,
  href: hrefProp,
  favorited: favoritedProp,
  onToggled,
}: {
  label: string;
  /** Omit on a tab bar (the current URL is used); pass it where the button
   *  represents some other row, as on the home panel. */
  href?: string;
  /** Known up front on home, so that render skips the state fetch below. */
  favorited?: boolean;
  onToggled?: (favorited: boolean) => void;
}) {
  const location = useLocation();
  const href = hrefProp ?? `${location.pathname}${location.search}`;
  const known = favoritedProp !== undefined;
  const [favorited, setFavorited] = useState(favoritedProp ?? false);
  const [ready, setReady] = useState(known);
  const [busy, setBusy] = useState(false);

  // Ask the server whether this URL is already starred. Client-side because the
  // bar renders on 41 different routes — threading the answer through every one
  // of their loaders would be far more invasive than one small fetch.
  useEffect(() => {
    if (known) return;
    let live = true;
    setReady(false);
    fetch(`/api/favorites/route?href=${encodeURIComponent(href)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        setFavorited(!!d?.favorited);
        setReady(true);
      })
      .catch(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, [href, known]);

  async function toggle() {
    const next = !favorited;
    setFavorited(next);
    setBusy(true);
    try {
      const res = await fetch("/api/favorites/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ href, label, favorited: next }),
      });
      if (res.ok) onToggled?.(next);
      else setFavorited(!next);
    } catch {
      setFavorited(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tooltip label={favorited ? "In your favourites" : "Add this page to your favourites"}>
      <button
        type="button"
        disabled={busy || !ready}
        onClick={() => void toggle()}
        aria-label={favorited ? "Remove from favourites" : "Add to favourites"}
        aria-pressed={favorited}
        className={`inline-flex items-center justify-center rounded-md p-1.5 transition-colors disabled:opacity-40 ${
          favorited
            ? "text-accent-coral"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Star className={`h-4 w-4 ${favorited ? "fill-current" : ""}`} />
      </button>
    </Tooltip>
  );
}
