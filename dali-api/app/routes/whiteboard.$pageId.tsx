import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/whiteboard.$pageId";
import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { parseSessionCookie } from "~/lib/cookies";
import { getPresenceUser } from "~/lib/presence-user";
import { getPageAccess } from "~/lib/pageAccess.server";
import { recordPageVisit } from "~/lib/user-pages.server";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { WhiteboardEditor } from "~/components/whiteboard/WhiteboardEditor";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · DALI OS` : "Whiteboard · DALI OS" }];
};

// Fill the shell's main column (no page scroll) — the canvas manages its own
// pan/zoom, like the calendar surface.
export const handle = { fitViewport: true };

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  // Whiteboards ship behind a flag; gate the deep link so a disabled feature
  // isn't reachable by URL. 404 (not redirect) so existence isn't leaked.
  const roles = await getUserRoles(auth.user.sub);
  if (!(await isFeatureEnabled("whiteboard", auth.user.sub, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }

  const page = await prisma.page.findUnique({
    where: { id: params.pageId },
    select: {
      id: true,
      title: true,
      kind: true,
      archivedAt: true,
      iconEmoji: true,
      workspaceType: true,
      workspaceId: true,
      partnerVisible: true,
      profileVisible: true,
      labListing: true,
      linkAccess: true,
      linkPermission: true,
      createdById: true,
    },
  });
  if (!page || page.archivedAt !== null) {
    throw new Response("Not found", { status: 404 });
  }
  // A non-whiteboard page reached via this URL belongs in the document editor.
  if (page.kind !== "Whiteboard") {
    return redirect(`/documents/${page.id}`);
  }

  const access = await getPageAccess(auth.user.sub, {
    id: page.id,
    workspaceType: page.workspaceType,
    workspaceId: page.workspaceId,
    archivedAt: page.archivedAt,
    createdById: page.createdById,
    partnerVisible: page.partnerVisible,
    profileVisible: page.profileVisible,
    labListing: page.labListing,
    linkAccess: page.linkAccess,
    linkPermission: page.linkPermission,
  });
  if (!access.canView) throw new Response("Not found", { status: 404 });

  recordPageVisit(auth.user.sub, page.id, request);

  const collabToken = parseSessionCookie(request);
  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email;
  const presenceUser = await getPresenceUser(auth.user.sub, fallbackName);

  return {
    pageId: page.id,
    title: page.title,
    iconEmoji: page.iconEmoji,
    canEdit: access.canEdit,
    collabToken,
    userName: presenceUser?.name ?? fallbackName,
    currentUserId: auth.user.sub,
    photoUrl: presenceUser?.photoUrl ?? null,
  };
}

export default function WhiteboardPage() {
  const data = useLoaderData() as Exclude<Awaited<ReturnType<typeof loader>>, Response>;
  return (
    <WhiteboardEditor
      pageId={data.pageId}
      title={data.title}
      iconEmoji={data.iconEmoji}
      canEdit={data.canEdit}
      collabToken={data.collabToken}
      userName={data.userName}
      currentUserId={data.currentUserId}
      photoUrl={data.photoUrl}
    />
  );
}
