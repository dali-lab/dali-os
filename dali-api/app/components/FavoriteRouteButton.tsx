import { useEffect, useState } from "react";
import { useLocation, useMatches } from "react-router";
import { Star } from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";
import { isNavbarRoute } from "~/lib/navbar-routes";
import { useFeatureFlag } from "~/components/FeatureFlags";

// Stars a page you're currently on — for DB-backed detail pages (project,
// person, partner org). Document pages use FavoriteStar instead.
//
// On detail pages the star sits inline after the breadcrumb trail via
// handle.favoriteRoute on the route. Navbar-linked hubs no longer show a
// page-level star.
export function FavoriteRouteButton({
  label: labelProp,
  href: hrefProp,
  favorited: favoritedProp,
  onToggled,
  compact = false,
  suppressWhenPills = false,
  inline = false,
  className = "",
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
  /** Breadcrumb placement — no ml-auto push to the far edge. */
  inline?: boolean;
  className?: string;
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

  // The owner may learn the answer after we first render — a tab bar resolves
  // its whole row in one request — and useState only reads its initial value,
  // so adopt the prop when it changes.
  useEffect(() => {
    if (favoritedProp !== undefined) setFavorited(favoritedProp);
  }, [favoritedProp]);

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

  // Pills only render when the sidebar redesign is off (AreaPillNav returns null
  // when on), so "on a pill page" is only true in that mode.
  const redesign = useFeatureFlag("sidebar-redesign");
  const hasAreaPills = !redesign && matches.some(
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
  if (isNavbarRoute(href)) return null;

  return (
    // portal when compact: these sit inside the tab bar's horizontal scroller,
    // and an absolutely-positioned tip counts toward a scroll container's
    // overflow — 20px of phantom vertical scroll before this.
    <Tooltip
      label={favorited ? "In your favorites" : "Add this page to your favorites"}
      portal={compact}
    >
      <button
        type="button"
        disabled={busy || !ready}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void toggle();
        }}
        aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={favorited}
        className={`inline-flex items-center justify-center transition-colors disabled:opacity-40 ${
          compact ? "" : inline ? "shrink-0 rounded-md p-1" : "ml-auto shrink-0 rounded-md p-1.5"
        } ${
          favorited ? "text-accent-coral" : "text-muted-foreground hover:text-foreground"
        } ${compact ? "" : "hover:bg-muted"} ${className}`}
      >
        <Star
          className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} ${favorited ? "fill-current" : ""}`}
        />
      </button>
    </Tooltip>
  );
}
