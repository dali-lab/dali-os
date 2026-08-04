import { useEffect, useState } from "react";
import { useLocation, useMatches } from "react-router";
import { Star } from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";

// Stars the page you're currently on — for destinations that aren't documents:
// a project hub, an area landing, any subtab.
//
// Placement follows the Guide button exactly (see PageDocButton): the layout
// header owns it, except on pill pages where AreaPillNav does. Both land in the
// same top-right cluster either way — the header row on a pill page sits above
// the tabs in an otherwise empty band, and a lone star floating up there reads
// as detached from the page.
//
// The current URL comes from the router. Search params are included — subtabs
// are ?tab=…, and dropping them would make every tab of a page one favourite.
// The label defaults to the document title, which every route already sets.
export function FavoriteRouteButton({
  label: labelProp,
  href: hrefProp,
  favorited: favoritedProp,
  onToggled,
  compact = false,
  suppressWhenPills = false,
}: {
  /** Defaults to the page's own title. */
  label?: string;
  /** Omit on a tab bar (the current URL is used); pass it where the button
   *  represents some other row, as on the home panel. */
  href?: string;
  /** Known up front on home, so that render skips the state fetch below. */
  favorited?: boolean;
  onToggled?: (favorited: boolean) => void;
  /** List rows use the same small star as FavoriteStar, so the two line up. */
  compact?: boolean;
  /** Set by the layout: pill pages render it in the pill row instead. */
  suppressWhenPills?: boolean;
}) {
  const matches = useMatches();
  const location = useLocation();
  const href = hrefProp ?? `${location.pathname}${location.search}`;
  const known = favoritedProp !== undefined;
  // Titles are "<page> · DALI OS"; keep the page part.
  const label =
    labelProp ??
    (typeof document !== "undefined" ? document.title.split(" · ")[0] : "") ??
    href;
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

  const hasAreaPills = matches.some(
    (m) => (m as { handle?: { areaPills?: boolean } }).handle?.areaPills,
  );

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

  if (suppressWhenPills && hasAreaPills) return null;

  return (
    <Tooltip label={favorited ? "In your favourites" : "Add this page to your favourites"}>
      <button
        type="button"
        disabled={busy || !ready}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void toggle();
        }}
        aria-label={favorited ? "Remove from favourites" : "Add to favourites"}
        aria-pressed={favorited}
        className={`inline-flex items-center justify-center transition-colors disabled:opacity-40 ${
          compact ? "" : "rounded-md p-1.5"
        } ${
          favorited ? "text-accent-coral" : "text-muted-foreground hover:text-foreground"
        } ${compact ? "" : "hover:bg-muted"}`}
      >
        <Star
          className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} ${favorited ? "fill-current" : ""}`}
        />
      </button>
    </Tooltip>
  );
}
