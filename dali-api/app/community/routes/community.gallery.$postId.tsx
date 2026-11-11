import { useState } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { EyeOff } from "lucide-react";
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
import { PostComments } from "~/components/PostComments";
import { ReactionBar, useReactionToggle } from "~/components/ReactionBar";
import { GalleryMasonry } from "~/community/components/GalleryMasonry";
import { GalleryNavRow } from "~/community/components/GalleryNavRow";
import { GalleryPostMenu } from "~/community/components/GalleryPostMenu";
import { NewGalleryPostsDialog } from "~/community/components/NewGalleryPostsDialog";
import { useOsChrome } from "~/components/os-chrome";

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
  const chrome = useOsChrome();

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-6">
        <GalleryNavRow onPost={() => setComposing(true)} />

        <PostCloseup key={post.id} post={post} />

        {more.length > 0 && (
          <div className={`${chrome.sectionShell} pt-4`}>
            <h2 className={chrome.sectionTitle}>More to explore</h2>
            <GalleryMasonry posts={more} />
          </div>
        )}
      </section>
      {composing && <NewGalleryPostsDialog userId={userId} onClose={() => setComposing(false)} />}
    </div>
  );
}

function PostCloseup({ post }: { post: GalleryPostDetail }) {
  const { reactions, react } = useReactionToggle(post.id, post.reactions);
  const restore = useFetcher();
  const portrait = post.height > post.width;

  return (
    <article className="mx-auto grid w-full max-w-[1040px] overflow-hidden rounded-os-card bg-os-card md:grid-cols-[minmax(0,1.25fr)_minmax(320px,1fr)]">
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

        <ReactionBar reactions={reactions} palette={GALLERY_EMOJI} onReact={react} />

        <PostComments
          postId={post.id}
          comments={post.comments}
          maxLength={GALLERY_COMMENT_MAX}
          avatarSize="compact"
          fill
          renderAuthor={(c) => (
            <Link
              to={galleryFeedHref({ by: c.author.id })}
              className="font-semibold text-foreground hover:underline"
            >
              {galleryByline(c.author.name, c.author.classYear)}
            </Link>
          )}
        />
      </div>
    </article>
  );
}
