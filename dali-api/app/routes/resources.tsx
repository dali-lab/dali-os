import { NavLink, Outlet, redirect, useFetcher, useLoaderData } from "react-router";
import { PenLine, Plus } from "lucide-react";
import type { Route } from "./+types/resources";
import { prisma } from "~/lib/db";
import { blogPostRoomName } from "~/collab/roomName";
import { cn } from "~/lib/cn";
import { requireResourcesViewer } from "~/lib/resources.server";
import { UNTOUCHED_DRAFT } from "~/lib/blog-post.server";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";

export const meta: Route.MetaFunction = () => [{ title: "Resources · DALI OS" }];

// Edge to edge: Resources is a paper sheet, not cards on a tinted wash.
export const handle = { bleedPane: true };

export async function loader({ request }: Route.LoaderArgs) {
  const { core } = await requireResourcesViewer(request);
  const bookmarks = await prisma.resourceBookmark.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true },
  });
  return { bookmarks, canManage: core };
}

export async function action({ request }: Route.ActionArgs) {
  const { user, core } = await requireResourcesViewer(request);
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

  if (intent === "createBookmark") {
    if (!core) throw new Response("Forbidden", { status: 403 });
    const title = String(form.get("title") ?? "").trim();
    if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
    const last = await prisma.resourceBookmark.aggregate({ _max: { position: true } });
    const bookmark = await prisma.resourceBookmark.create({
      data: { title, position: (last._max.position ?? -1) + 1 },
      select: { id: true },
    });
    return redirect(`/resources/b/${bookmark.id}`);
  }

  throw new Response("Bad request", { status: 400 });
}

const TAB =
  "whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-semibold uppercase tracking-wider transition-colors";

export default function ResourcesLayout() {
  const { bookmarks, canManage } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const dialog = useDialog();

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      TAB,
      isActive
        ? "border-foreground text-foreground"
        : "border-transparent text-os-grey hover:text-foreground",
    );

  async function addBookmark() {
    const title = await dialog.prompt({
      title: "New bookmark",
      label: "Name",
      confirmLabel: "Create",
    });
    if (title?.trim()) {
      fetcher.submit({ intent: "createBookmark", title }, { method: "post", action: "/resources" });
    }
  }

  return (
    <div className="min-h-dvh bg-card px-6 pb-16 sm:px-10">
      <header className="relative border-b border-foreground pb-4 pt-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-os-grey">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "America/New_York",
          })}
        </p>
        <h1 className="mt-1 font-serif text-5xl font-bold tracking-tight text-foreground">
          Everything DALI
        </h1>
        <button
          type="button"
          onClick={() =>
            fetcher.submit({ intent: "createPost" }, { method: "post", action: "/resources" })
          }
          disabled={fetcher.state !== "idle"}
          className="os-btn-primary os-btn-primary--sm absolute bottom-4 right-0"
        >
          <PenLine className="h-4 w-4" />
          Write
        </button>
      </header>
      <nav
        aria-label="Bookmarks"
        className="flex items-center gap-6 overflow-x-auto border-b border-border"
      >
        <NavLink to="/resources" end className={tabClass}>
          The Scoop
        </NavLink>
        {bookmarks.map((b) => (
          <NavLink key={b.id} to={`/resources/b/${b.id}`} className={tabClass}>
            {b.title}
          </NavLink>
        ))}
        {canManage && <IconButton label="New bookmark" icon={Plus} onClick={addBookmark} />}
      </nav>
      <Outlet />
    </div>
  );
}
