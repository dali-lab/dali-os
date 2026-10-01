import { useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { ArrowDown, ArrowUp, Check, Globe, Pencil, Pin, PinOff } from "lucide-react";
import type { Route } from "./+types/resources._index";
import { prisma } from "~/lib/db";
import { cn } from "~/lib/cn";
import { fullName, formatDateShort } from "~/lib/display";
import { DEFAULT_BLOG_COVER, blogListing } from "~/lib/blog-preview";
import { requireResourcesViewer } from "~/lib/resources.server";
import {
  UNTOUCHED_DRAFT,
  moveBlogPostPin,
  pinBlogPostToTop,
  unpinBlogPost,
} from "~/lib/blog-post.server";
import { IconButton } from "~/components/ui/IconButton";
import { Tooltip } from "~/components/ui/floating/Tooltip";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";

// The front page: published posts laid out like a newspaper. Core's pinned
// posts lead in the order Core arranged them, then the rest newest first. The
// viewer's own drafts sit below.
export async function loader({ request }: Route.LoaderArgs) {
  const { user, core } = await requireResourcesViewer(request);
  const rows = await prisma.blogPost.findMany({
    where: {
      OR: [{ publishedAt: { not: null } }, { authorId: user.sub, NOT: UNTOUCHED_DRAFT }],
    },
    orderBy: [
      { frontPageRank: { sort: "asc", nulls: "last" } },
      { publishedAt: "desc" },
      { updatedAt: "desc" },
    ],
    select: {
      id: true,
      title: true,
      excerpt: true,
      summary: true,
      coverImageUrl: true,
      customCoverUrl: true,
      visibility: true,
      publishedAt: true,
      frontPageRank: true,
      author: { select: { firstName: true, lastName: true } },
    },
  });
  const posts = rows.map((r) => ({
    id: r.id,
    title: r.title,
    ...blogListing(r),
    isPublic: r.visibility === "Public",
    published: r.publishedAt !== null,
    pinned: r.frontPageRank !== null,
    date: r.publishedAt ? formatDateShort(r.publishedAt) : null,
    author: fullName(r.author),
  }));
  return {
    published: posts.filter((p) => p.published),
    drafts: posts.filter((p) => !p.published),
    canCurate: core,
  };
}

// Core's curation. Each change names one post; the order is worked out
// server-side (see blog-post.server.ts).
export async function action({ request }: Route.ActionArgs) {
  const { core } = await requireResourcesViewer(request);
  if (!core) throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const postId = String(form.get("postId") ?? "");
  switch (form.get("intent")) {
    case "pin":
      await pinBlogPostToTop(postId);
      break;
    case "unpin":
      await unpinBlogPost(postId);
      break;
    case "move":
      await moveBlogPostPin(postId, form.get("by") === "-1" ? -1 : 1);
      break;
    default:
      throw new Response("Bad request", { status: 400 });
  }
  return { ok: true };
}

type Post = Awaited<ReturnType<typeof loader>>["published"][number];

function Byline({ post, showPin }: { post: Post; showPin: boolean }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-os-grey">
      {showPin && post.pinned && (
        <Tooltip content="Pinned">
          <Pin className="h-3.5 w-3.5 fill-current" aria-label="Pinned" />
        </Tooltip>
      )}
      {post.author}
      {post.date && <span className="font-normal normal-case tracking-normal">· {post.date}</span>}
      {post.isPublic && (
        <Tooltip content="Also on the DALI website">
          <Globe className="h-3.5 w-3.5" aria-label="Public" />
        </Tooltip>
      )}
    </p>
  );
}

type Curate = {
  submit: (data: Record<string, string>) => void;
  busy: boolean;
  /** Pinned post ids in display order. */
  pinnedIds: string[];
};

function Story({
  post,
  size,
  curate,
  showPin,
}: {
  post: Post;
  size: "lead" | "side" | "more";
  curate?: Curate;
  /** Core sees which stories are pinned, in and out of Edit mode. */
  showPin: boolean;
}) {
  const at = curate ? curate.pinnedIds.indexOf(post.id) : -1;
  return (
    <div className="flex flex-col gap-2">
      {curate && (
        <div className="flex items-center gap-1 rounded-os-item bg-os-well px-1.5 py-1">
          <IconButton
            label={at >= 0 ? "Unpin" : "Pin to top"}
            icon={at >= 0 ? PinOff : Pin}
            disabled={curate.busy}
            onClick={() => curate.submit({ intent: at >= 0 ? "unpin" : "pin", postId: post.id })}
          />
          {at >= 0 && (
            <>
              <IconButton
                label="Move earlier"
                icon={ArrowUp}
                disabled={curate.busy || at === 0}
                onClick={() => curate.submit({ intent: "move", postId: post.id, by: "-1" })}
              />
              <IconButton
                label="Move later"
                icon={ArrowDown}
                disabled={curate.busy || at === curate.pinnedIds.length - 1}
                onClick={() => curate.submit({ intent: "move", postId: post.id, by: "1" })}
              />
            </>
          )}
        </div>
      )}
      {/* Lead: words beside the picture. Side: a headline with a thumbnail.
          More: a small card. The picture never spans the page on its own. */}
      <Link
        to={`/resources/blog/${post.id}`}
        className={cn(
          "group",
          size === "lead" && "grid items-start gap-6 md:grid-cols-5",
          size === "side" && "flex items-start gap-4",
          size === "more" && "flex flex-col gap-3",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 flex-col gap-2 px-2 py-1",
            size === "lead" && "md:col-span-2",
            size === "side" && "flex-1",
            size === "more" && "order-2",
          )}
        >
          <h2
            className={cn(
              "font-serif font-bold leading-tight text-foreground group-hover:underline",
              size === "lead" ? "text-3xl xl:text-4xl" : "text-lg",
            )}
          >
            {post.title}
          </h2>
          {post.excerpt && size !== "side" && (
            <p
              className={cn(
                "font-serif text-os-grey",
                size === "lead" ? "line-clamp-5 text-base" : "line-clamp-2 text-sm",
              )}
            >
              {post.excerpt}
            </p>
          )}
          <Byline post={post} showPin={showPin} />
        </div>
        <img
          src={post.coverImageUrl ?? DEFAULT_BLOG_COVER}
          alt=""
          className={cn(
            "rounded-lg object-cover",
            size === "lead" && "aspect-[3/2] w-full md:col-span-3",
            size === "side" && "h-20 w-28 shrink-0",
            size === "more" && "order-1 aspect-[3/2] w-full",
          )}
        />
      </Link>
    </div>
  );
}

export default function ResourcesFrontPage() {
  const { published, drafts, canCurate } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [editing, setEditing] = useState(false);
  const [lead, ...rest] = published;
  const side = rest.slice(0, 3);
  const more = rest.slice(3);

  // One change at a time: the controls wait for the last one to land, so a
  // quick second click can't act on an order that is about to change.
  const curate: Curate | undefined = editing
    ? {
        pinnedIds: published.filter((p) => p.pinned).map((p) => p.id),
        busy: fetcher.state !== "idle",
        submit: (data) => fetcher.submit(data, { method: "post" }),
      }
    : undefined;

  return (
    <div className="flex flex-col gap-8 pt-4">
      <div className="flex min-h-9 justify-end">
        {canCurate && lead && (
          <button
            type="button"
            onClick={() => setEditing((on) => !on)}
            aria-pressed={editing}
            className="os-btn-primary os-btn-primary--sm"
          >
            {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      {!lead && (
        <p className="py-16 text-center font-serif text-lg text-os-grey">
          Nothing published yet. Write the first post.
        </p>
      )}
      {lead && (
        <section className="grid gap-8 xl:grid-cols-3">
          <div className={cn(side.length > 0 ? "xl:col-span-2" : "xl:col-span-3")}>
            <Story post={lead} size="lead" curate={curate} showPin={canCurate} />
          </div>
          {side.length > 0 && (
            <div className="flex flex-col divide-y divide-border xl:border-l xl:border-border xl:pl-8">
              {side.map((p) => (
                <div key={p.id} className="py-5 first:pt-0 last:pb-0">
                  <Story post={p} size="side" curate={curate} showPin={canCurate} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {more.length > 0 && (
        <section className="grid gap-x-8 gap-y-10 border-t border-foreground pt-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {more.map((p) => (
            <Story key={p.id} post={p} size="more" curate={curate} showPin={canCurate} />
          ))}
        </section>
      )}
      {drafts.length > 0 && (
        <section className="border-t border-foreground pt-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-os-grey">
            Your drafts
          </h2>
          <ul className="mt-2 divide-y divide-border">
            {drafts.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/resources/write/${p.id}`}
                  className="flex items-center justify-between gap-4 py-3 hover:underline"
                >
                  <span className="font-serif text-lg font-bold text-foreground">{p.title}</span>
                  <Pill dot="neutral">Draft</Pill>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
