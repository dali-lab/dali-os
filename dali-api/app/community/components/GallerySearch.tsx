import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { cn } from "~/lib/cn";
import { Avatar } from "~/components/ui/Avatar";
import { SearchInput } from "~/components/ui/SearchInput";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";
import type { GalleryPerson, GalleryTileData } from "~/community/lib/gallery.server";
import { galleryByline, galleryFeedHref } from "~/community/lib/gallery";

const SEARCH_DEBOUNCE_MS = 300;
const POST_SUGGESTIONS = 3;

/** Results the feed's loader returned for `q`, offered in the dropdown. */
export type GallerySearchResults = { q: string; people: GalleryPerson[]; posts: GalleryTileData[] };

type Item = { kind: "person"; person: GalleryPerson } | { kind: "post"; post: GalleryTileData };

// Typing searches the feed itself: a short pause after the last keystroke
// navigates to ?q=, the loader answers with the matching posts and people in
// one response, and a newer navigation cancels an older one. The dropdown
// offers people (to filter to one) and the top posts (to open one).
export function GallerySearch({
  mine,
  results,
}: {
  mine: boolean;
  /** Null off the feed (a post page): typing there goes to the feed. */
  results: GallerySearchResults | null;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const resultsQ = results?.q ?? "";
  const [value, setValue] = useState(resultsQ);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // Back/forward or a person pick changes the search under us; follow it unless
  // the reader is mid-edit.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setValue(resultsQ);
  }, [resultsQ]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Arriving from a post page's search box: keep typing where you left off.
  const fromSearch = (location.state as { gallerySearch?: boolean } | null)?.gallerySearch;
  const onFeed = results !== null;
  useEffect(() => {
    if (fromSearch && onFeed && document.activeElement !== inputRef.current) {
      inputRef.current?.focus();
      setOpen(true);
    }
    // Once per arrival, not on every result the search brings back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  function go(q: string) {
    window.clearTimeout(timer.current);
    navigate(galleryFeedHref({ mine, q }), {
      replace: results !== null,
      preventScrollReset: true,
      state: { gallerySearch: true },
    });
  }

  function onChange(next: string) {
    setValue(next);
    setActive(-1);
    setOpen(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => go(next), SEARCH_DEBOUNCE_MS);
  }

  const typed = value.trim();
  const searching = typed !== resultsQ;
  const items: Item[] =
    results && !searching && typed
      ? [
          ...results.people.map((person) => ({ kind: "person" as const, person })),
          ...results.posts.slice(0, POST_SUGGESTIONS).map((post) => ({ kind: "post" as const, post })),
        ]
      : [];

  function pick(item: Item) {
    window.clearTimeout(timer.current);
    setOpen(false);
    if (item.kind === "person") {
      setValue("");
      navigate(galleryFeedHref({ by: item.person.id }));
    } else {
      navigate(`/community/gallery/${item.post.id}`);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if (e.key === "ArrowDown" && items.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp" && items.length > 0) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && items[active]) pick(items[active]);
      else go(value);
    }
  }

  const showList = open && results !== null && typed !== "";
  const people = items.filter((i) => i.kind === "person");
  const posts = items.filter((i) => i.kind === "post");

  return (
    <div role="search" className="relative min-w-[200px] max-w-md flex-1">
      <SearchInput
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder="Search posts and people"
        aria-label="Search posts and people"
        aria-expanded={showList}
        aria-controls="gallery-search-list"
        autoComplete="off"
      />
      {showList && (
        <div
          id="gallery-search-list"
          role="listbox"
          aria-label="Search suggestions"
          // Keep focus in the field so a click still lands.
          onMouseDown={(e) => e.preventDefault()}
          className={cn("absolute inset-x-0 top-full z-30 mt-1 overflow-hidden p-1.5", OS_SURFACE_CLASS)}
        >
          {searching ? (
            <div role="status" aria-live="polite" className="flex items-center gap-2 px-2.5 py-2 text-sm text-os-muted">
              <Loader2 className="h-4 w-4 animate-spin text-os-accent motion-reduce:animate-none" aria-hidden />
              Searching…
            </div>
          ) : items.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-os-muted">No matches</p>
          ) : (
            <>
              {people.length > 0 && <SectionLabel>People</SectionLabel>}
              {people.map((item) => {
                if (item.kind !== "person") return null;
                const idx = items.indexOf(item);
                return (
                  <Row key={item.person.id} active={idx === active} onHover={() => setActive(idx)} onPick={() => pick(item)}>
                    <Avatar size="compact" name={item.person.name} photoUrl={item.person.photoUrl} />
                    <Lines
                      title={galleryByline(item.person.name, item.person.classYear)}
                      detail={item.person.postCount === 1 ? "1 post" : `${item.person.postCount} posts`}
                    />
                  </Row>
                );
              })}
              {posts.length > 0 && <SectionLabel>Posts</SectionLabel>}
              {posts.map((item) => {
                if (item.kind !== "post") return null;
                const idx = items.indexOf(item);
                const { post } = item;
                return (
                  <Row key={post.id} active={idx === active} onHover={() => setActive(idx)} onPick={() => pick(item)}>
                    <img
                      src={post.imageUrl}
                      alt=""
                      className="h-6 w-6 shrink-0 rounded-md object-cover"
                      style={{ backgroundColor: post.color }}
                    />
                    <Lines
                      title={post.caption ?? "Photo"}
                      detail={galleryByline(post.author.name, post.author.classYear)}
                    />
                  </Row>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-widest text-os-muted first:pt-1">
      {children}
    </p>
  );
}

function Row({
  active,
  onHover,
  onPick,
  children,
}: {
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseMove={onHover}
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-os-item px-2.5 py-2 text-left",
        active ? "bg-os-well" : "hover:bg-os-well",
      )}
    >
      {children}
    </button>
  );
}

function Lines({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm font-semibold text-foreground">{title}</span>
      <span className="truncate text-xs text-os-muted">{detail}</span>
    </span>
  );
}
