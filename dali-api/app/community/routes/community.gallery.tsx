import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { ArrowUp, ImagePlus, Loader2, Plus } from "lucide-react";
import type { Route } from "./+types/community.gallery";
import {
  firstPostAt,
  galleryAction,
  loadGalleryPage,
  loadGalleryPerson,
  searchGalleryPeople,
  parseFeedQuery,
  requireGalleryViewer,
  type GalleryTileData,
} from "~/community/lib/gallery.server";
import { GalleryMasonry } from "~/community/components/GalleryMasonry";
import { GalleryNavRow } from "~/community/components/GalleryNavRow";
import { NewGalleryPostsDialog } from "~/community/components/NewGalleryPostsDialog";
import { galleryByline, galleryFeedHref } from "~/community/lib/gallery";

export const meta: Route.MetaFunction = () => [{ title: "Gallery · DALI OS" }];

export const handle = {
  breadcrumb: () => "Gallery",
};

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireGalleryViewer(request);
  const query = parseFeedQuery(new URL(request.url));
  const firstPage = !query.cursor;
  const [page, since, people, person] = await Promise.all([
    loadGalleryPage(viewer, query),
    firstPage ? firstPostAt(viewer) : null,
    firstPage && query.q ? searchGalleryPeople(viewer, query.q) : [],
    query.by ? loadGalleryPerson(viewer, query.by) : null,
  ]);
  return { ...page, query, firstPostAt: since, people, person, userId: viewer.id };
}

export async function action({ request }: Route.ActionArgs) {
  return galleryAction(request, await requireGalleryViewer(request));
}

const NEW_POSTS_POLL_MS = 60_000;

export default function CommunityGallery() {
  const data = useLoaderData<typeof loader>();
  const { query } = data;
  const [composing, setComposing] = useState(false);

  // Later pages append below the loader's first page; a new filter starts over.
  const [more, setMore] = useState<{ posts: GalleryTileData[]; nextCursor: string | null }>({
    posts: [],
    nextCursor: data.nextCursor,
  });
  const queryKey = `${query.mine}|${query.by}|${query.q}`;
  useEffect(() => setMore({ posts: [], nextCursor: data.nextCursor }), [queryKey]);

  const pager = useFetcher<typeof loader>();
  useEffect(() => {
    if (pager.state !== "idle" || !pager.data) return;
    const page = pager.data;
    setMore((m) => ({
      posts: [...m.posts, ...page.posts.filter((p) => !m.posts.some((x) => x.id === p.id))],
      nextCursor: page.nextCursor,
    }));
  }, [pager.state, pager.data]);

  // A revalidation can pull a later page's first posts up into page one.
  const firstIds = new Set(data.posts.map((p) => p.id));
  const posts = [...data.posts, ...more.posts.filter((p) => !firstIds.has(p.id))];
  const loading = pager.state !== "idle";

  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more.nextCursor) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || pager.state !== "idle") return;
        const href = galleryFeedHref({ mine: query.mine, by: query.by, q: query.q });
        pager.load(`${href}${href.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(more.nextCursor!)}`);
      },
      { rootMargin: "800px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [more.nextCursor, pager, query.mine, query.by, query.q]);

  const filtered = query.mine || query.by !== null || query.q !== "";
  const { person } = data;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">Gallery</h1>
      <NewPostsPill newestAt={data.posts[0]?.createdAt ?? null} enabled={!filtered} />
      <section className="flex flex-col gap-6 rounded-os-card bg-os-card p-5">
        <div className="flex flex-col gap-4">
          <GalleryNavRow
            mine={query.mine}
            person={person}
            results={{ q: query.q, people: data.people, posts: data.posts }}
            onPost={() => setComposing(true)}
          />
          {person && (
            <p className="flex items-baseline gap-2">
              <span className="text-[19px] font-bold text-foreground">
                {galleryByline(person.name, person.classYear)}
              </span>
              <span className="text-sm text-os-muted">
                {person.postCount === 1 ? "1 post" : `${person.postCount} posts`}
              </span>
            </p>
          )}
        </div>

        {posts.length === 0 ? (
          person ? (
            <p className="py-16 text-center text-sm text-os-grey">
              {query.q ? `No posts by ${person.name} match "${query.q}".` : `${person.name} hasn't posted yet.`}
            </p>
          ) : (
            <EmptyFeed mine={query.mine} q={query.q} onPost={() => setComposing(true)} />
          )
        ) : (
          <>
            <GalleryMasonry posts={posts} hideBylines={person !== null} />
            <div ref={sentinel} aria-hidden />
            {loading && (
              <div className="flex justify-center py-6 text-os-grey">
                <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading more" />
              </div>
            )}
            {!more.nextCursor && !filtered && (
              <FeedEnd firstPostAt={data.firstPostAt} onPost={() => setComposing(true)} />
            )}
          </>
        )}
      </section>
      {composing && <NewGalleryPostsDialog userId={data.userId} onClose={() => setComposing(false)} />}
    </div>
  );
}

function FeedEnd({ firstPostAt, onPost }: { firstPostAt: string | null; onPost: () => void }) {
  const since = firstPostAt
    ? new Date(firstPostAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;
  return (
    <div className="flex flex-col items-center gap-4 pb-4 pt-6">
      <div className="flex w-full max-w-md items-center gap-4 text-sm text-os-grey">
        <span className="h-px flex-1 bg-os-container" aria-hidden />
        <span className="shrink-0" suppressHydrationWarning>
          That's everything.{since ? ` First post: ${since}.` : ""}
        </span>
        <span className="h-px flex-1 bg-os-container" aria-hidden />
      </div>
      <button type="button" onClick={onPost} className="os-add-btn">
        <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
        Post
      </button>
    </div>
  );
}

function EmptyFeed({ mine, q, onPost }: { mine: boolean; q: string; onPost: () => void }) {
  if (q) {
    return <p className="py-16 text-center text-sm text-os-grey">No posts match "{q}".</p>;
  }
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-os-container text-os-grey">
        <ImagePlus className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="text-lg font-semibold text-foreground">
        {mine ? "You haven't posted yet" : "Nothing posted yet"}
      </h2>
      <p className="max-w-sm text-sm text-os-grey">
        Share a photo from the lab. Members, staff, and alumni will see it.
      </p>
      <button type="button" onClick={onPost} className="os-add-btn mt-2">
        <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
        {mine ? "Post a photo" : "Post the first one"}
      </button>
    </div>
  );
}

// New posts never push the feed around under the reader. They wait behind a
// pill; clicking it scrolls up and reloads.
function NewPostsPill({ newestAt, enabled }: { newestAt: string | null; enabled: boolean }) {
  const counter = useFetcher<{ count: number }>();
  const revalidator = useRevalidator();
  const anchor = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      counter.load(`/community/gallery/new-count?since=${encodeURIComponent(newestAt ?? new Date(0).toISOString())}`);
    };
    const timer = window.setInterval(poll, NEW_POSTS_POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, newestAt]);

  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const count = counter.data?.count ?? 0;
  const show = enabled && count > 0 && dismissedFor !== newestAt;

  return (
    <div ref={anchor} className="pointer-events-none sticky top-2 z-20 -mb-4 flex h-0 justify-center">
      {show && (
        <button
          type="button"
          onClick={() => {
            setDismissedFor(newestAt);
            anchor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            revalidator.revalidate();
          }}
          className="pointer-events-auto inline-flex h-9 animate-gallery-pill items-center gap-1.5 rounded-full bg-os-accent px-4 text-sm font-semibold text-os-bg shadow-lg"
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
          {count === 1 ? "1 new post" : `${count} new posts`}
        </button>
      )}
    </div>
  );
}
