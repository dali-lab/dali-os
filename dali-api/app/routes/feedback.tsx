import { data, useFetcher, useLoaderData } from "react-router";
import { MessageCircle, Plus, Trash2 } from "lucide-react";
import type { Route } from "./+types/feedback";
import { prisma } from "~/lib/db.server";
import { cn } from "~/lib/cn";
import { relativeTime } from "~/lib/relative-time";
import { checkRateLimit } from "~/lib/rate-limit";
import { requireFeedbackViewer } from "~/lib/feedback.server";
import { extractHandlesFromText, notifyMentions, resolveHandles } from "~/lib/mentions";
import { toggleReaction } from "~/lib/reactions.server";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_COMMENT_MAX,
  FEEDBACK_EMOJI,
  isFeedbackScreenshotKey,
  FEED_IDS_MAX,
} from "~/lib/feedback";
import { loadFeedbackPage, type FeedbackFeedPost } from "~/lib/feedback-feed.server";
import { fetchCursorPage } from "~/hooks/useLoadMore";
import { useRefreshedLoadMore } from "~/hooks/useRefreshedLoadMore";
import { LoadMore } from "~/components/ui/Pager";
import { useOsChrome } from "~/components/os-chrome";
import { Avatar } from "~/components/ui/Avatar";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { PostComments } from "~/components/PostComments";
import { ReactionBar, useReactionToggle } from "~/components/ReactionBar";
import { useFeedbackComposer } from "~/components/feedback/FeedbackComposer";
import { useDialog } from "~/components/ui/dialog";

export const meta: Route.MetaFunction = () => [{ title: "Feedback · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const { user, core } = await requireFeedbackViewer(request);
  return loadFeedbackPage(null, { userId: user.sub, core });
}

// Returned, not thrown: the shell's feedback button posts here through a
// fetcher, and a thrown response would land in the page's error boundary.
const fail = (status: number) => data({ ok: false as const }, { status });

// False for a post deleted while someone still has the feed open.
async function postExists(id: string) {
  const post = await prisma.feedbackPost.findUnique({ where: { id }, select: { id: true } });
  return post !== null;
}

export async function action({ request }: Route.ActionArgs) {
  const { user, core } = await requireFeedbackViewer(request);
  const form = await request.formData();
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const postId = text("postId");

  switch (form.get("intent")) {
    case "create": {
      const limited = checkRateLimit(request, { max: 10, windowMs: 60_000 }, `feedback:${user.sub}`);
      if (limited) return fail(429);
      const body = text("body");
      const screenshotKey = text("screenshotKey");
      const pagePath = text("pagePath");
      if (!body || body.length > FEEDBACK_BODY_MAX) return fail(400);
      if (screenshotKey && !isFeedbackScreenshotKey(screenshotKey)) return fail(400);
      await prisma.feedbackPost.create({
        data: {
          authorId: user.sub,
          body,
          screenshotKey: screenshotKey || null,
          pagePath: pagePath.startsWith("/") ? pagePath.slice(0, 500) : null,
        },
      });
      break;
    }
    case "react": {
      const limited = checkRateLimit(request, { max: 60, windowMs: 60_000 }, `feedback-react:${user.sub}`);
      if (limited) return fail(429);
      const emoji = text("emoji");
      if (!(await postExists(postId))) return fail(404);
      const mine = { postId, userId: user.sub, emoji };
      const result = await toggleReaction(
        {
          remove: async () => (await prisma.feedbackReaction.deleteMany({ where: mine })).count,
          usedEmoji: async () =>
            (
              await prisma.feedbackReaction.findMany({
                where: { postId },
                select: { emoji: true },
                distinct: ["emoji"],
              })
            ).map((r) => r.emoji),
          add: () =>
            prisma.feedbackReaction.upsert({
              where: { postId_userId_emoji: mine },
              create: mine,
              update: {},
            }),
        },
        emoji,
      );
      if (typeof result === "number") return fail(result);
      break;
    }
    case "comment": {
      const limited = checkRateLimit(request, { max: 30, windowMs: 60_000 }, `feedback-comment:${user.sub}`);
      if (limited) return fail(429);
      const body = text("body");
      if (!body || body.length > FEEDBACK_COMMENT_MAX) return fail(400);
      if (!(await postExists(postId))) return fail(404);
      await prisma.feedbackComment.create({ data: { postId, authorId: user.sub, body } });
      await notifyMentions({
        recipientUserIds: await resolveHandles(extractHandlesFromText(body)),
        actorId: user.sub,
        link: "/feedback",
        copyKey: "mention.comment",
        preview: body,
      });
      break;
    }
    case "delete":
      await prisma.feedbackPost.deleteMany({
        where: { id: postId, ...(core ? {} : { authorId: user.sub }) },
      });
      break;
    case "delete-comment":
      await prisma.feedbackComment.deleteMany({
        where: { id: text("commentId"), ...(core ? {} : { authorId: user.sub }) },
      });
      break;
    default:
      return fail(400);
  }
  return { ok: true as const };
}

type Post = FeedbackFeedPost;

const FEED_URL = "/api/feedback/posts";

async function fetchPostsByIds(ids: string[]): Promise<Post[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += FEED_IDS_MAX) chunks.push(ids.slice(i, i + FEED_IDS_MAX));
  const pages = await Promise.all(
    chunks.map((chunk) => fetchCursorPage<Post>(`${FEED_URL}?ids=${encodeURIComponent(chunk.join(","))}`)),
  );
  return pages.flatMap((page) => page.items);
}

function Byline({ name, at, pagePath }: { name: string; at: string; pagePath?: string | null }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-semibold text-foreground">{name}</span>
      <span className="text-xs text-os-grey" suppressHydrationWarning>
        {relativeTime(at)}
      </span>
      {pagePath && <span className="truncate text-xs text-os-muted">on {pagePath}</span>}
    </p>
  );
}

function Reactions({ post }: { post: Post }) {
  const { reactions, react } = useReactionToggle(post.id, post.reactions);
  return <ReactionBar reactions={reactions} palette={FEEDBACK_EMOJI} onReact={react} />;
}

function PostCard({ post }: { post: Post }) {
  const { card, panelPad } = useOsChrome();
  const dialog = useDialog();
  const remove = useFetcher();

  async function onDelete() {
    const ok = await dialog.confirm({
      title: "Delete this request?",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) remove.submit({ intent: "delete", postId: post.id }, { method: "post" });
  }

  return (
    <article className={cn(card, panelPad, "flex flex-col gap-4")}>
      <div className="flex items-start gap-3">
        <Avatar size="md" name={post.author.name} photoUrl={post.author.photoUrl} />
        <div className="min-w-0 flex-1">
          <Byline name={post.author.name} at={post.createdAt} pagePath={post.pagePath} />
          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] text-foreground">
            {post.body}
          </p>
        </div>
        {post.canDelete && (
          <IconButton label="Delete" icon={Trash2} tone="destructive" onClick={onDelete} />
        )}
      </div>
      {post.screenshotUrl && (
        <a
          href={post.screenshotUrl}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-os-item border border-os-container bg-os-well"
        >
          <img
            src={post.screenshotUrl}
            alt="Screenshot"
            loading="lazy"
            className="max-h-[420px] w-full object-contain"
          />
        </a>
      )}
      <Reactions post={post} />
      <PostComments postId={post.id} comments={post.comments} maxLength={FEEDBACK_COMMENT_MAX} />
    </article>
  );
}

export default function FeedbackFeed() {
  const { items, nextCursor } = useLoaderData<typeof loader>();
  const { items: posts, pager } = useRefreshedLoadMore<Post>({
    items,
    nextCursor,
    fetchPage: (cursor) => fetchCursorPage<Post>(`${FEED_URL}?cursor=${encodeURIComponent(cursor)}`),
    fetchByIds: fetchPostsByIds,
  });
  const { pageTitle, bodyText } = useOsChrome();
  // No page path: "on /feedback" says nothing about what the request is for.
  const composer = useFeedbackComposer({ pagePath: "", fetcherKey: "os-feedback-create-page" });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-3xl items-center justify-between gap-4">
        <h1 className={pageTitle}>Feature requests</h1>
        <Button onClick={composer.compose} className="shrink-0">
          <Plus className="h-4 w-4" aria-hidden />
          New request
        </Button>
      </div>
      {posts.length === 0 ? (
        <p className={cn(bodyText, "flex items-center gap-2")}>
          <MessageCircle className="h-4 w-4" aria-hidden />
          No requests yet.
        </p>
      ) : (
        <div className="flex max-w-3xl flex-col gap-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
          <LoadMore {...pager} />
        </div>
      )}
      {composer.ui}
    </div>
  );
}
