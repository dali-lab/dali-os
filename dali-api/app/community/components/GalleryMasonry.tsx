import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { EyeOff, MessageCircle } from "lucide-react";
import { cn } from "~/lib/cn";
import { Avatar } from "~/components/ui/Avatar";
import { ReactionPicker } from "~/components/ReactionBar";
import type { GalleryTileData } from "~/community/lib/gallery.server";
import {
  GALLERY_EMOJI,
  galleryByline,
  galleryColumnCount,
  galleryFeedHref,
  layoutMasonry,
  toggleReaction,
} from "~/community/lib/gallery";
import { GalleryPostMenu } from "./GalleryPostMenu";

export function galleryPostHref(id: string) {
  return `/community/gallery/${id}`;
}

/** Pinterest-style columns: each tile drops into the shortest column so far. */
export function GalleryMasonry({
  posts,
  hideBylines = false,
}: {
  posts: GalleryTileData[];
  /** On one person's posts, every byline would be the same name. */
  hideBylines?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setColumns(galleryColumnCount(entry.contentRect.width)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="flex items-start gap-4">
      {layoutMasonry(posts, columns).map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-5">
          {col.map((post) => (
            <GalleryTile key={post.id} post={post} hideByline={hideBylines} />
          ))}
        </div>
      ))}
    </div>
  );
}

function GalleryTile({ post, hideByline }: { post: GalleryTileData; hideByline: boolean }) {
  const fetcher = useFetcher();
  const href = galleryPostHref(post.id);
  const [reactions, setReactions] = useState(post.reactions);
  useEffect(() => setReactions(post.reactions), [post.reactions]);
  const top = reactions.reduce<GalleryTileData["reactions"][number] | null>(
    (best, r) => (!best || r.count > best.count ? r : best),
    null,
  );

  return (
    <article className="group/tile flex animate-gallery-tile flex-col gap-2">
      <div className="relative">
        <Link
          to={href}
          className={cn(
            "block overflow-hidden rounded-os-item focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent",
            post.hidden && "opacity-50",
          )}
          style={{ aspectRatio: `${post.width} / ${post.height}`, backgroundColor: post.color }}
        >
          <img
            src={post.imageUrl}
            alt={post.caption ?? `Photo by ${post.author.name}`}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover/tile:scale-[1.02]"
          />
        </Link>
        {post.hidden && (
          <span className="pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-os-bg/90 px-2 py-0.5 text-xs font-semibold text-foreground">
            <EyeOff className="h-3.5 w-3.5" aria-hidden />
            Hidden
          </span>
        )}
        <div className="absolute inset-x-2.5 bottom-2.5 flex items-center justify-between opacity-0 transition-opacity focus-within:opacity-100 group-hover/tile:opacity-100 touch:hidden">
          <div className="flex items-center gap-1 rounded-full bg-os-card/95 p-0.5 shadow-sm">
            <ReactionPicker
              palette={GALLERY_EMOJI}
              onReact={(emoji) => {
                setReactions((rs) => toggleReaction(rs, emoji));
                fetcher.submit(
                  { intent: "react", postId: post.id, emoji },
                  { method: "post", action: href },
                );
              }}
            />
            <Link
              to={href}
              aria-label="Comment"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <div className="rounded-full bg-os-card/95 p-0.5 shadow-sm">
            <GalleryPostMenu post={post} />
          </div>
        </div>
      </div>

      {post.caption && (
        <Link to={href} className="line-clamp-2 px-0.5 text-sm font-semibold text-foreground">
          {post.caption}
        </Link>
      )}
      {(!hideByline || top || post.commentCount > 0) && (
        <div className="flex items-center gap-2 px-0.5 text-xs text-os-grey">
          {hideByline ? (
            <span className="flex-1" />
          ) : (
            <Link
              to={galleryFeedHref({ by: post.author.id })}
              className="flex min-w-0 flex-1 items-center gap-2 hover:text-foreground"
            >
              <Avatar size="xs" name={post.author.name} photoUrl={post.author.photoUrl} />
              <span className="truncate">
                {galleryByline(post.author.name, post.author.classYear)}
              </span>
            </Link>
          )}
          {top && (
            <span className={cn("shrink-0 tabular-nums", top.mine && "text-os-accent")}>
              {top.emoji} {top.count}
            </span>
          )}
          {post.commentCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums">
              <MessageCircle className="h-3.5 w-3.5" aria-hidden />
              {post.commentCount}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
