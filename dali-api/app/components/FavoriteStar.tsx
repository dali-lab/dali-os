import { Star } from "lucide-react";
import { Tooltip } from "~/components/ui/floating";
import { useFavoriteToggle } from "~/components/favorites-live";

// One star for every place a page is listed. Personal, unlike the shared Pin:
// it only affects the clicker's own favorites, so it needs no permission gate
// beyond being able to see the row. It does not revalidate the route: these
// stars live in long lists where a reload per click would be felt.
export function FavoriteStar({
  pageId,
  favorited: initial,
  className = "",
  iconClassName = "w-3.5 h-3.5",
  onToggled,
}: {
  pageId: string;
  favorited: boolean;
  className?: string;
  /** The star's size. Rows use the small default; a page title asks for more. */
  iconClassName?: string;
  /** Called after a successful write. Home uses it to re-sort the panel, since
   *  un-starring there should move the row out of Favorites immediately. */
  onToggled?: (favorited: boolean) => void;
}) {
  const { favorited, busy, toggle } = useFavoriteToggle({ pageId }, initial, onToggled);

  return (
    <Tooltip content={favorited ? "Remove from favorites" : "Add to favorites"}>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void toggle();
        }}
        aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={favorited}
        className={`flex items-center disabled:opacity-60 transition-colors ${
          favorited ? "text-os-accent" : "text-muted-foreground hover:text-foreground"
        } ${className}`}
      >
        <Star className={`${iconClassName} ${favorited ? "fill-current" : ""}`} />
      </button>
    </Tooltip>
  );
}
