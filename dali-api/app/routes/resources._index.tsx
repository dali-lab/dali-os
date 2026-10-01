import { useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { ArrowDown, ArrowUp, Check, Globe, Pencil, Pin, PinOff } from "lucide-react";
import type { Route } from "./+types/resources._index";
import { prisma } from "~/lib/db";
import { cn } from "~/lib/cn";
import { fullName, formatDateShort } from "~/lib/display";
import { blogListing } from "~/lib/blog-preview";
import { requireResourcesViewer } from "~/lib/resources.server";
import { UNTOUCHED_DRAFT } from "~/lib/blog-post.server";
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

// Core's arrangement arrives whole: the pinned post ids in display order.
// Everything not listed is unpinned.
export async function action({ request }: Route.ActionArgs) {
  const { core } = await requireResourcesViewer(request);
  if (!core) throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  if (form.get("intent") !== "arrange") throw new Response("Bad request", { status: 400 });
  const ids = String(form.get("pinned") ?? "").split(",").filter(Boolean);
  await prisma.$transaction([
    prisma.blogPost.updateMany({
      where: { id: { notIn: ids }, frontPageRank: { not: null } },
      data: { frontPageRank: null },
    }),
    ...ids.map((id, rank) =>
      prisma.blogPost.updateMany({ where: { id }, data: { frontPageRank: rank } }),
    ),
  ]);
  return { ok: true };
}

type Post = Awaited<ReturnType<typeof loader>>["published"][number];

function Byline({ post }: { post: Post }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-os-grey">
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
  pin: (id: string) => void;
  move: (id: string, by: -1 | 1) => void;
  pinnedIds: string[];
};

function Story({
  post,
  size,
  curate,
}: {
  post: Post;
  size: "lead" | "side" | "more";
  curate?: Curate;
}) {
  const at = curate ? curate.pinnedIds.indexOf(post.id) : -1;
  return (
    <div className="flex flex-col gap-2">
      {curate && (
        <div className="flex items-center gap-1 rounded-os-item bg-os-well px-1.5 py-1">
          <IconButton
            label={at >= 0 ? "Unpin" : "Pin to top"}
            icon={at >= 0 ? PinOff : Pin}
            onClick={() => curate.pin(post.id)}
          />
          {at >= 0 && (
            <>
              <IconButton
                label="Move earlier"
                icon={ArrowUp}
                disabled={at === 0}
                onClick={() => curate.move(post.id, -1)}
              />
              <IconButton
                label="Move later"
                icon={ArrowDown}
                disabled={at === curate.pinnedIds.length - 1}
                onClick={() => curate.move(post.id, 1)}
              />
            </>
          )}
        </div>
      )}
      <Link to={`/resources/blog/${post.id}`} className="group flex flex-col gap-2">
        {post.coverImageUrl && size !== "side" && (
          <img
            src={post.coverImageUrl}
            alt=""
            className={cn("w-full object-cover", size === "lead" ? "aspect-[16/9]" : "aspect-[3/2]")}
          />
        )}
        <h2
          className={cn(
            "font-serif font-bold leading-tight text-foreground group-hover:underline",
            size === "lead" ? "text-4xl" : size === "side" ? "text-xl" : "text-2xl",
          )}
        >
          {post.title}
        </h2>
        {post.excerpt && (
          <p
            className={cn(
              "font-serif text-os-grey",
              size === "lead" ? "text-lg" : "line-clamp-3 text-sm",
            )}
          >
            {post.excerpt}
          </p>
        )}
        <Byline post={post} />
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

  const pinnedIds = published.filter((p) => p.pinned).map((p) => p.id);
  const arrange = (ids: string[]) =>
    fetcher.submit({ intent: "arrange", pinned: ids.join(",") }, { method: "post" });
  const curate: Curate | undefined = editing
    ? {
        pinnedIds,
        pin: (id) =>
          arrange(pinnedIds.includes(id) ? pinnedIds.filter((p) => p !== id) : [...pinnedIds, id]),
        move: (id, by) => {
          const from = pinnedIds.indexOf(id);
          const next = [...pinnedIds];
          next.splice(from, 1);
          next.splice(from + by, 0, id);
          arrange(next);
        },
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
        <section className="grid gap-8 lg:grid-cols-3">
          <div className={cn(side.length > 0 ? "lg:col-span-2" : "lg:col-span-3")}>
            <Story post={lead} size="lead" curate={curate} />
          </div>
          {side.length > 0 && (
            <div className="flex flex-col divide-y divide-border lg:border-l lg:border-border lg:pl-8">
              {side.map((p) => (
                <div key={p.id} className="py-5 first:pt-0 last:pb-0">
                  <Story post={p} size="side" curate={curate} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {more.length > 0 && (
        <section className="grid gap-x-8 gap-y-10 border-t border-foreground pt-8 sm:grid-cols-2 lg:grid-cols-3">
          {more.map((p) => (
            <Story key={p.id} post={p} size="more" curate={curate} />
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
