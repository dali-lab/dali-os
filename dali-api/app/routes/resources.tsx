import { useState } from "react";
import { Outlet, redirect, useFetcher, useRouteLoaderData } from "react-router";
import { Check, PenLine, Pencil } from "lucide-react";
import type { Route } from "./+types/resources";
import type { loader as frontPageLoader } from "./resources._index";
import { prisma } from "~/lib/db";
import { blogPostRoomName } from "~/collab/roomName";
import { requireResourcesViewer } from "~/lib/resources.server";
import { UNTOUCHED_DRAFT } from "~/lib/blog-post.server";

export const meta: Route.MetaFunction = () => [{ title: "Resources · DALI OS" }];

// Edge to edge: Resources is a paper sheet, not cards on a tinted wash.
export const handle = { bleedPane: true };

export async function loader({ request }: Route.LoaderArgs) {
  await requireResourcesViewer(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireResourcesViewer(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "createPost") {
    // An untouched draft is never kept: Write reopens one if it exists and
    // clears any others, instead of leaving an empty row behind per click.
    const [reuse, ...stale] = await prisma.blogPost.findMany({
      where: { authorId: user.sub, ...UNTOUCHED_DRAFT },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (stale.length > 0) {
      const ids = stale.map((p) => p.id);
      await prisma.$transaction([
        prisma.collabDocument.deleteMany({ where: { name: { in: ids.map(blogPostRoomName) } } }),
        prisma.blogPost.deleteMany({ where: { id: { in: ids } } }),
      ]);
    }
    const post =
      reuse ??
      (await prisma.blogPost.create({
        data: { title: UNTOUCHED_DRAFT.title, authorId: user.sub },
        select: { id: true },
      }));
    return redirect(`/resources/write/${post.id}`);
  }

  throw new Response("Bad request", { status: 400 });
}

export type ResourcesOutletContext = { editing: boolean };

export default function ResourcesLayout() {
  const fetcher = useFetcher();
  // Core arranges the front page from here, beside Write, once something is published.
  const front = useRouteLoaderData<typeof frontPageLoader>("routes/resources._index");
  const canCurate = !!front?.canCurate && front.published.length > 0;
  const [editingFront, setEditing] = useState(false);
  const editing = editingFront && canCurate;

  return (
    <div className="min-h-dvh bg-card px-6 pb-16 sm:px-10">
      <header className="relative border-b border-os-container pb-4 pt-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-os-grey">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "America/New_York",
          })}
        </p>
        <h1 className="mt-1 font-heading text-5xl font-semibold tracking-tight text-foreground">
          Everything DALI
        </h1>
        <div className="absolute bottom-4 right-0 flex items-center gap-2">
          {canCurate && (
            <button
              type="button"
              onClick={() => setEditing((on) => !on)}
              aria-pressed={editing}
              className="os-btn-primary os-btn-primary--sm os-btn-tint"
            >
              {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              {editing ? "Done" : "Edit"}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              fetcher.submit({ intent: "createPost" }, { method: "post", action: "/resources" })
            }
            disabled={fetcher.state !== "idle"}
            className="os-btn-primary os-btn-primary--sm os-btn-tint"
          >
            <PenLine className="h-4 w-4" />
            Write
          </button>
        </div>
      </header>
      <Outlet context={{ editing } satisfies ResourcesOutletContext} />
    </div>
  );
}
