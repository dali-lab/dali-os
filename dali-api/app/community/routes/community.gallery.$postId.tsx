import { useEffect, useRef, useState } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { ArrowLeft, EyeOff, Trash2 } from "lucide-react";
import type { Route } from "./+types/community.gallery.$postId";
import {
  galleryAction,
  loadGalleryPage,
  loadGalleryPost,
  requireGalleryViewer,
  type GalleryPostDetail,
} from "~/community/lib/gallery.server";
import {
  GALLERY_COMMENT_MAX,
  GALLERY_EMOJI,
  GALLERY_REPORTS_TO_HIDE,
  galleryByline,
  galleryFeedHref,
} from "~/community/lib/gallery";
import { relativeTime } from "~/lib/relative-time";
import { cn } from "~/lib/cn";
import { Avatar } from "~/components/ui/Avatar";
import { IconButton } from "~/components/ui/IconButton";
import { ReactionBar } from "~/components/ReactionBar";
import { MentionText } from "~/components/MentionText";
import { MentionTextInput } from "~/components/MentionTextInput";
import { GalleryMasonry } from "~/community/components/GalleryMasonry";
import { GalleryNavRow } from "~/community/components/GalleryNavRow";
import { GalleryPostMenu } from "~/community/components/GalleryPostMenu";
import { NewGalleryPostsDialog } from "~/community/components/NewGalleryPostsDialog";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.post.caption ?? "Photo"} · Gallery · DALI OS` },
];

export const handle = {
  breadcrumb: (data: unknown) =>
    (data as { post?: { author: { name: string } } } | undefined)?.post?.author.name ?? "Post",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireGalleryViewer(request);
  const [post, more] = await Promise.all([
    loadGalleryPost(viewer, params.postId),
    loadGalleryPage(viewer, {
      mine: false,
      by: null,
      q: "",
      cursor: null,
      excludeId: params.postId,
    }),
  ]);
  if (!post) throw new Response("Not found", { status: 404 });
  return { post, more: more.posts, userId: viewer.id };
}

export async function action({ request }: Route.ActionArgs) {
  return galleryAction(request, await requireGalleryViewer(request));
}

// After deleting the post this page shows, reloading it would 404 on the way out.
export function shouldRevalidate({
  formData,
  formAction,
  currentUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formData?.get("intent") === "delete" && formAction === currentUrl.pathname) return false;
  return defaultShouldRevalidate;
}

export default function GalleryPostPage() {
  const { post, more, userId } = useLoaderData<typeof loader>();
  const [composing, setComposing] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-6 rounded-os-card bg-os-card p-5">
        <GalleryNavRow onPost={() => setComposing(true)} />

        <div className="relative lg:px-14">
          <BackButton />
          <PostCloseup key={post.id} post={post} />
        </div>

        {more.length > 0 && (
          <div className="flex flex-col gap-4 pt-4">
            <h2 className="text-center font-heading text-[19px] font-semibold text-foreground">
              More to explore
            </h2>
            <GalleryMasonry posts={more} />
          </div>
        )}
      </section>
      {composing && <NewGalleryPostsDialog userId={userId} onClose={() => setComposing(false)} />}
    </div>
  );
}

// Back to wherever the reader came from (a scrolled or filtered feed); straight
// to the feed when the post was opened from a link.
function BackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  // One element on server and client; the history check waits for the click,
  // since the server can't know whether there's a page to go back to.
  return (
    <Link
      to="/community/gallery"
      aria-label="Back to Gallery"
      onClick={(e) => {
        if (location.key === "default") return;
        e.preventDefault();
        navigate(-1);
      }}
      className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-os-container text-foreground transition-colors hover:bg-os-container-hi lg:absolute lg:left-0 lg:top-0 lg:mb-0"
    >
      <ArrowLeft className="h-5 w-5" aria-hidden />
    </Link>
  );
}

function PostCloseup({ post }: { post: GalleryPostDetail }) {
  const reactor = useFetcher();
  const restore = useFetcher();
  const portrait = post.height > post.width;

  return (
    <article className="mx-auto grid max-w-[1040px] overflow-hidden rounded-os-card border border-os-container bg-os-bg md:grid-cols-[minmax(0,1.25fr)_minmax(320px,1fr)]">
      <div
        className="flex items-center justify-center"
        style={{ backgroundColor: post.color }}
      >
        {/* The tile's thumbnail is already cached from the feed, so it shows at
            once underneath while the full image loads over it. */}
        <img
          src={post.fullImageUrl}
          alt={post.caption ?? `Photo by ${post.author.name}`}
          className={cn("w-full object-contain", portrait ? "max-h-[78vh]" : "max-h-[70vh]")}
          style={{
            aspectRatio: `${post.width} / ${post.height}`,
            background: `url("${post.imageUrl}") center / contain no-repeat`,
          }}
        />
      </div>

      <div className="flex min-h-0 flex-col gap-4 p-5 md:max-h-[78vh]">
        <header className="flex items-center gap-3">
          <Avatar size="md" name={post.author.name} photoUrl={post.author.photoUrl} />
          <div className="min-w-0 flex-1">
            <Link
              to={galleryFeedHref({ by: post.author.id })}
              className="block truncate text-sm font-semibold text-foreground hover:underline"
            >
              {galleryByline(post.author.name, post.author.classYear)}
            </Link>
            <p className="text-xs text-os-grey" suppressHydrationWarning>
              {relativeTime(post.createdAt)}
            </p>
          </div>
          <GalleryPostMenu post={post} leaveOnDelete />
        </header>

        {post.hidden && (
          <div className="flex items-start gap-2.5 rounded-os-item bg-os-container px-3 py-2.5 text-sm text-foreground">
            <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-os-grey" aria-hidden />
            <p className="min-w-0 flex-1">
              {post.reportCount >= GALLERY_REPORTS_TO_HIDE
                ? `Hidden after ${post.reportCount} reports.`
                : "Hidden by Core."}{" "}
              Only Core and the poster can see it.
            </p>
            {post.canModerate && (
              <button
                type="button"
                onClick={() =>
                  restore.submit({ intent: "restore", postId: post.id }, { method: "post" })
                }
                className="shrink-0 font-semibold text-os-accent hover:underline"
              >
                Restore
              </button>
            )}
          </div>
        )}

        {post.caption && (
          <p className="whitespace-pre-wrap break-words text-[15px] text-foreground">{post.caption}</p>
        )}

        <ReactionBar
          reactions={post.reactions}
          palette={GALLERY_EMOJI}
          onReact={(emoji) =>
            reactor.submit({ intent: "react", postId: post.id, emoji }, { method: "post" })
          }
        />

        <Comments post={post} />
      </div>
    </article>
  );
}

function Comments({ post }: { post: GalleryPostDetail }) {
  const fetcher = useFetcher();
  const remove = useFetcher();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const sent = fetcher.state === "idle" && fetcher.data != null;
  useEffect(() => {
    if (!sent) return;
    setDraft("");
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [sent, fetcher.data]);

  const busy = fetcher.state !== "idle";
  function send() {
    const body = draft.trim();
    if (!body || busy) return;
    fetcher.submit({ intent: "comment", postId: post.id, body }, { method: "post" });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 border-t border-os-container pt-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-os-grey">
        {post.comments.length === 0
          ? "Comments"
          : `${post.comments.length} ${post.comments.length === 1 ? "comment" : "comments"}`}
      </p>
      <div ref={listRef} className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
        {post.comments.length === 0 && <p className="text-sm text-os-muted">No comments yet.</p>}
        {post.comments.map((c) => (
          <div key={c.id} className="group flex items-start gap-2.5">
            <Avatar size="compact" name={c.author.name} photoUrl={c.author.photoUrl} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <Link
                  to={galleryFeedHref({ by: c.author.id })}
                  className="font-semibold text-foreground hover:underline"
                >
                  {galleryByline(c.author.name, c.author.classYear)}
                </Link>
                <span className="text-xs text-os-grey" suppressHydrationWarning>
                  {relativeTime(c.createdAt)}
                </span>
              </p>
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                <MentionText text={c.body} />
              </p>
            </div>
            {c.canDelete && (
              <IconButton
                label="Delete comment"
                icon={Trash2}
                tone="destructive"
                className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100"
                onClick={() =>
                  remove.submit({ intent: "delete-comment", commentId: c.id }, { method: "post" })
                }
              />
            )}
          </div>
        ))}
      </div>
      <form
        className="os-form flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <MentionTextInput
          value={draft}
          onChange={setDraft}
          maxLength={GALLERY_COMMENT_MAX}
          placeholder="Add a comment, @ to mention"
          ariaLabel="Add a comment"
          dropUp
          wrapperClassName="relative min-w-0 flex-1"
          className="w-full"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="os-btn-primary os-btn-primary--sm disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
