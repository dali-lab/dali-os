import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/documents.$pageId";
import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";
import { isCore, isProjectMember } from "~/lib/roles";
import { getPresenceUser } from "~/lib/presence-user";
import { DocumentEditor } from "~/components/DocumentEditor";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · DALI OS` : "Document · DALI OS" }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

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
  // Mirrors the doc gate in authorizeCollabDoc: live page, any workspaceType.
  if (!page || page.archivedAt !== null) {
    throw new Response("Not found", { status: 404 });
  }

  // Mirrors the doc gate in authorizeCollabDoc: Core everywhere, plus anyone
  // staffed on the project for Project-workspace pages (the same gate the
  // document API routes use — without this the editor rendered enabled but
  // the collab handshake rejected members).
  const canEdit =
    (await isCore(auth.user.sub)) ||
    (page.workspaceType === "Project" &&
      page.workspaceId !== null &&
      (await isProjectMember(auth.user.sub, page.workspaceId)));

  const allTags = await prisma.docTag.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
    select: { id: true, label: true, slug: true, color: true },
  });

  const collabToken = parseSessionCookie(request);
  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email;
  const presenceUser = await getPresenceUser(auth.user.sub, fallbackName);

  return {
    pageId: page.id,
    title: page.title,
    tags: page.tags.map((t) => t.tag).sort((a, b) => a.label.localeCompare(b.label)),
    allTags,
    canEdit,
    collabToken,
    userName: presenceUser?.name ?? fallbackName,
    currentUserId: auth.user.sub,
    photoUrl: presenceUser?.photoUrl ?? null,
    subtitle: presenceUser?.subtitle ?? null,
  };
}

export default function DocumentPage() {
  const {
    pageId,
    title,
    tags,
    allTags,
    canEdit,
    collabToken,
    userName,
    currentUserId,
    photoUrl,
    subtitle,
  } = useLoaderData() as Exclude<Awaited<ReturnType<typeof loader>>, Response>;

  return (
    <div className="flex flex-col gap-4">
      <DocumentEditor
        pageId={pageId}
        initialTitle={title}
        collabToken={collabToken}
        userName={userName}
        currentUserId={currentUserId}
        photoUrl={photoUrl}
        subtitle={subtitle}
        canEdit={canEdit}
        tags={tags}
        allTags={allTags}
      />
    </div>
  );
}
