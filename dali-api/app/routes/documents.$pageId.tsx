import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/documents.$pageId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";
import { isCore } from "~/lib/roles";
import { DocumentEditor } from "~/components/DocumentEditor";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · DALI OS` : "Document · DALI OS" }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const page = await prisma.page.findUnique({
    where: { id: params.pageId },
    select: {
      id: true,
      title: true,
      workspaceType: true,
      workspaceId: true,
      archivedAt: true,
      tags: { select: { tag: { select: { id: true, label: true, slug: true, color: true } } } },
    },
  });
  // Mirrors the doc gate in authorizeCollabDoc: live Project page only.
  if (!page || page.workspaceType !== "Project" || page.archivedAt !== null) {
    throw new Response("Not found", { status: 404 });
  }

  const canEdit = await isCore(auth.user.sub);

  // Resolve the parent project for the back link + breadcrumb.
  const project = page.workspaceId
    ? await prisma.project.findUnique({
        where: { id: page.workspaceId },
        select: { id: true, name: true },
      })
    : null;

  const allTags = await prisma.docTag.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
    select: { id: true, label: true, slug: true, color: true },
  });

  const collabToken = parseSessionCookie(request);
  const userName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email;

  return {
    pageId: page.id,
    title: page.title,
    tags: page.tags.map((t) => t.tag).sort((a, b) => a.label.localeCompare(b.label)),
    allTags,
    project,
    canEdit,
    collabToken,
    userName,
    currentUserId: auth.user.sub,
  };
}

export default function DocumentPage() {
  const { pageId, title, tags, allTags, project, canEdit, collabToken, userName, currentUserId } =
    useLoaderData() as Exclude<Awaited<ReturnType<typeof loader>>, Response>;

  return (
    <div className="flex flex-col gap-4">
      <Link
        to={project ? `/projects/${project.id}` : "/projects/list"}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← {project ? `Back to ${project.name}` : "Back to projects"}
      </Link>

      <DocumentEditor
        pageId={pageId}
        initialTitle={title}
        collabToken={collabToken}
        userName={userName}
        currentUserId={currentUserId}
        canEdit={canEdit}
        tags={tags}
        allTags={allTags}
      />
    </div>
  );
}
