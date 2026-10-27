import { useNavigate } from "react-router";
import { Plus, X } from "lucide-react";
import { Segmented } from "~/components/ui/Segmented";
import { Avatar } from "~/components/ui/Avatar";
import type { GalleryPerson } from "~/community/lib/gallery.server";
import { galleryFeedHref } from "~/community/lib/gallery";
import { GallerySearch, type GallerySearchResults } from "./GallerySearch";

/** The gallery's one nav row: All · Mine (or a person), search, and Post. Same on the feed and a post page. */
export function GalleryNavRow({
  mine = false,
  person = null,
  results = null,
  onPost,
}: {
  mine?: boolean;
  /** Set when the feed is filtered to one person's posts. */
  person?: GalleryPerson | null;
  results?: GallerySearchResults | null;
  onPost: () => void;
}) {
  const navigate = useNavigate();
  const q = results?.q ?? "";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <Segmented<"all" | "mine">
          value={mine && !person ? "mine" : "all"}
          onChange={(next) =>
            navigate(galleryFeedHref(next === "mine" ? { mine: true, q } : { q }))
          }
          ariaLabel="Show"
          size="md"
          pill
          options={[
            { value: "all", label: "All" },
            { value: "mine", label: "Mine" },
          ]}
        />
        {person && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-os-container py-1 pl-1 pr-1.5 text-sm font-medium text-foreground">
            <Avatar size="compact" name={person.name} photoUrl={person.photoUrl} />
            {person.name}
            <button
              type="button"
              aria-label={`Stop showing only ${person.name}'s posts`}
              onClick={() => navigate(galleryFeedHref({ q }))}
              className="flex h-6 w-6 items-center justify-center rounded-full text-os-grey hover:bg-os-container-hi hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        )}
      </div>
      <GallerySearch mine={mine} results={results} />
      <button type="button" onClick={onPost} className="os-btn-primary os-btn-tint ml-auto">
        <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
        Post
      </button>
    </div>
  );
}
