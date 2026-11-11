import { useNavigate } from "react-router";
import { Plus, X } from "lucide-react";
import { Segmented } from "~/components/ui/Segmented";
import { Avatar } from "~/components/ui/Avatar";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
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
          options={[
            { value: "all", label: "All" },
            { value: "mine", label: "Mine" },
          ]}
        />
        {person && (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card pl-1.5 pr-1 text-sm text-foreground">
            <Avatar size="compact" name={person.name} photoUrl={person.photoUrl} />
            {person.name}
            <IconButton
              label={`Stop showing only ${person.name}'s posts`}
              icon={X}
              onClick={() => navigate(galleryFeedHref({ q }))}
              iconClassName="h-3.5 w-3.5"
            />
          </span>
        )}
      </div>
      <GallerySearch mine={mine} results={results} />
      <GalleryPostButton onClick={onPost} className="ml-auto" />
    </div>
  );
}

export function GalleryPostButton({
  onClick,
  label = "Post",
  className,
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <Button onClick={onClick} className={className}>
      <Plus className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}
