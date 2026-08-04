import { useState } from "react";
import { Star } from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";

// One star for every place a page is listed — the Documents hub, a project's
// Documents block, education materials, profile pages.
//
// Personal, unlike the shared Pin: it only affects the clicker's own home
// Favourites, so it needs no permission gate beyond being able to see the row.
//
// Optimistic, and it does NOT revalidate the route on success: these stars live
// in long lists where a full reload on every click would be felt. The server is
// the source of truth on the next load; on failure the star reverts.
export function FavoriteStar({
  pageId,
  favorited: initial,
  className = "",
}: {
  pageId: string;
  favorited: boolean;
  className?: string;
}) {
  const [favorited, setFavorited] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !favorited;
    setFavorited(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/pages/${pageId}/favorite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ favorited: next }),
      });
      if (!res.ok) setFavorited(!next);
    } catch {
      setFavorited(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tooltip label={favorited ? "In your favourites" : "Add to your favourites"}>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          // Rows are usually links or open-in-tab buttons; starring must not
          // navigate.
          e.preventDefault();
          e.stopPropagation();
          void toggle();
        }}
        aria-label={favorited ? "Remove from favourites" : "Add to favourites"}
        aria-pressed={favorited}
        className={`flex items-center disabled:opacity-60 transition-colors ${
          favorited ? "text-accent-coral" : "text-muted-foreground hover:text-foreground"
        } ${className}`}
      >
        <Star className={`w-3.5 h-3.5 ${favorited ? "fill-current" : ""}`} />
      </button>
    </Tooltip>
  );
}
