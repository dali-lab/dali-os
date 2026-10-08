import { useEffect, useRef } from "react";
import { data, useFetcher, useLoaderData } from "react-router";
import { MessageCircle, SmilePlus, Trash2 } from "lucide-react";
import type { Route } from "./+types/feedback";
import { prisma } from "~/lib/db";
import { cn } from "~/lib/cn";
import { fullName } from "~/lib/display";
import { resolvePhotoUrl } from "~/lib/photo";
import { relativeTime } from "~/lib/relative-time";
import { checkRateLimit } from "~/lib/rate-limit";
import { requireFeedbackViewer } from "~/lib/feedback.server";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_COMMENT_MAX,
  FEEDBACK_EMOJI,
  isFeedbackEmoji,
  isFeedbackScreenshotKey,
  summarizeReactions,
} from "~/lib/feedback";
import { useOsChrome } from "~/components/os-chrome";
import { Avatar } from "~/components/ui/Avatar";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Popover } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";

export const meta: Route.MetaFunction = () => [{ title: "Feedback · DALI OS" }];

const FEED_LIMIT = 100;
const AUTHOR_SELECT = { id: true, firstName: true, lastName: true, photoUrl: true } as const;

export async function loader({ request }: Route.LoaderArgs) {
  const { user, core } = await requireFeedbackViewer(request);
  const rows = await prisma.feedbackPost.findMany({
    orderBy: { createdAt: "desc" },
    take: FEED_LIMIT,
    select: {
      id: true,
      body: true,
      screenshotKey: true,
      pagePath: true,
      createdAt: true,
      author: { select: AUTHOR_SELECT },
      reactions: { select: { emoji: true, userId: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, createdAt: true, author: { select: AUTHOR_SELECT } },
      },
    },
  });

  // One presign per distinct author, not per post and comment.
  const photoByUser = new Map<string, Promise<string | null>>();
  const person = async (author: (typeof rows)[number]["author"]) => {
    if (!photoByUser.has(author.id)) photoByUser.set(author.id, resolvePhotoUrl(author.photoUrl));
    return { id: author.id, name: fullName(author), photoUrl: await photoByUser.get(author.id)! };
  };

  const posts = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      body: r.body,
      pagePath: r.pagePath,
      screenshotUrl: r.screenshotKey
        ? `/api/upload/raw?key=${encodeURIComponent(r.screenshotKey)}`
        : null,
      createdAt: r.createdAt.toISOString(),
      author: await person(r.author),
      canDelete: core || r.author.id === user.sub,
      reactions: summarizeReactions(r.reactions, user.sub),
      comments: await Promise.all(
        r.comments.map(async (c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          author: await person(c.author),
          canDelete: core || c.author.id === user.sub,
        })),
      ),
    })),
  );
  return { posts };
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
      const emoji = text("emoji");
      if (!isFeedbackEmoji(emoji)) return fail(400);
      if (!(await postExists(postId))) return fail(404);
      const mine = { postId, userId: user.sub, emoji };
      const { count } = await prisma.feedbackReaction.deleteMany({ where: mine });
      if (count === 0) {
        await prisma.feedbackReaction.upsert({
          where: { postId_userId_emoji: mine },
          create: mine,
          update: {},
        });
      }
      break;
    }
    case "comment": {
      const limited = checkRateLimit(request, { max: 30, windowMs: 60_000 }, `feedback-comment:${user.sub}`);
      if (limited) return fail(429);
      const body = text("body");
      if (!body || body.length > FEEDBACK_COMMENT_MAX) return fail(400);
      if (!(await postExists(postId))) return fail(404);
      await prisma.feedbackComment.create({ data: { postId, authorId: user.sub, body } });
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

type Post = Awaited<ReturnType<typeof loader>>["posts"][number];

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
  const fetcher = useFetcher();
  const react = (emoji: string) =>
    fetcher.submit({ intent: "react", postId: post.id, emoji }, { method: "post" });
  const chip =
    "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-sm transition-colors";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {post.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          aria-pressed={r.mine}
          aria-label={`${r.emoji} ${r.count}`}
          onClick={() => react(r.emoji)}
          className={cn(
            chip,
            r.mine
              ? "border-os-accent/30 bg-os-accent/15 text-os-accent"
              : "border-os-container text-os-grey hover:border-os-container-hi hover:text-foreground",
          )}
        >
          <span aria-hidden>{r.emoji}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}
      <Popover
        ariaLabel="Add reaction"
        panelClassName="z-[60] w-max p-1.5"
        trigger={<IconButton label="React" icon={SmilePlus} className="h-8 w-8 rounded-full" />}
      >
        {(close) => (
          <div className="flex gap-0.5">
            {FEEDBACK_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  react(emoji);
                  close();
                }}
                className="flex h-9 w-9 items-center justify-center rounded-os-item text-xl hover:bg-os-container"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
}

function Comments({ post }: { post: Post }) {
  const fetcher = useFetcher();
  const remove = useFetcher();
  const formRef = useRef<HTMLFormElement | null>(null);
  const { formClass } = useOsChrome();
  const sent = fetcher.state === "idle" && fetcher.data != null;
  useEffect(() => {
    if (sent) formRef.current?.reset();
  }, [sent, fetcher.data]);

  return (
    <div className="flex flex-col gap-3 border-t border-os-container pt-4">
      {post.comments.map((c) => (
        <div key={c.id} className="group flex items-start gap-2.5">
          <Avatar size="sm" name={c.author.name} photoUrl={c.author.photoUrl} />
          <div className="min-w-0 flex-1">
            <Byline name={c.author.name} at={c.createdAt} />
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{c.body}</p>
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
      <fetcher.Form ref={formRef} method="post" className={cn(formClass, "flex items-center gap-2")}>
        <input type="hidden" name="intent" value="comment" />
        <input type="hidden" name="postId" value={post.id} />
        <input
          type="text"
          name="body"
          required
          maxLength={FEEDBACK_COMMENT_MAX}
          placeholder="Add a comment"
          aria-label="Add a comment"
          autoComplete="off"
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" disabled={fetcher.state !== "idle"}>
          Send
        </Button>
      </fetcher.Form>
    </div>
  );
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
      <Comments post={post} />
    </article>
  );
}

export default function FeedbackFeed() {
  const { posts } = useLoaderData<typeof loader>();
  const { pageTitle, bodyText } = useOsChrome();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className={pageTitle}>Feature requests</h1>
        <p className={bodyText}>What lab members want from DALI OS. React to back a request.</p>
      </div>
      {posts.length === 0 ? (
        <p className={cn(bodyText, "flex items-center gap-2")}>
          <MessageCircle className="h-4 w-4" aria-hidden />
          No requests yet. Use the feedback button in the corner to add one.
        </p>
      ) : (
        <div className="flex max-w-3xl flex-col gap-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
