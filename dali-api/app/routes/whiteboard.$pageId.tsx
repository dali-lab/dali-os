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
import { driveFolderCrumbs } from "~/lib/drive-crumbs.server";
import { driveRootCrumbs } from "~/lib/drive-crumbs";
import { Shapes } from "lucide-react";
import { ProjectIcon } from "~/components/ProjectIcon";
import { FolderIcon } from "~/components/FolderIcon";
import { WhiteboardEditor } from "~/components/whiteboard/WhiteboardEditor";

// Leading glyph for a whiteboard in the breadcrumb trail: its custom emoji, else
// a canvas/shapes icon (matching the Drive browser) — never the plain doc glyph.
function WhiteboardCrumbIcon({ iconEmoji }: { iconEmoji?: string | null }) {
  return (
    <span className="flex w-4 flex-shrink-0 items-center justify-center leading-none" aria-hidden>
      {iconEmoji ? (
        <span className="text-sm">{iconEmoji}</span>
      ) : (
        <Shapes className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </span>
  );
}

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · DALI OS` : "Whiteboard · DALI OS" }];
};

export const handle = {
  // Fill the shell's main column (no page scroll) — the canvas manages its own
  // pan/zoom, like the calendar surface.
  fitViewport: true,
  // Same Drive / hub ancestry as the document viewer, ending at the whiteboard,
  // so the shell breadcrumb reads e.g. "Drive ▸ Folder ▸ <title>" rather than
  // the generic "… ▸ Details" fallback.
  breadcrumbTrail: (data: unknown) => {
    const d = data as
      | {
          title?: string;
          iconEmoji?: string | null;
          hubName?: string | null;
          hubHref?: string | null;
          hubIconEmoji?: string | null;
          workspaceType?: string;
          driveCrumbs?: {
            scope: string;
            folders: { id: string; title: string; iconEmoji: string | null }[];
          } | null;
        }
      | undefined;
    if (!d?.title) return null;
    // Lab / personal pages root at Drive, then walk the folder path.
    if (!d.hubName || !d.hubHref) {
      const scope = d.driveCrumbs?.scope ?? "lab";
      return [
        ...driveRootCrumbs(scope),
        ...(d.driveCrumbs?.folders ?? []).map((f) => ({
          label: f.title || "Untitled folder",
          to: `/drive?scope=${scope}&folder=${f.id}`,
          icon: <FolderIcon iconEmoji={f.iconEmoji} />,
        })),
        { label: d.title, icon: <WhiteboardCrumbIcon iconEmoji={d.iconEmoji} /> },
      ];
    }
    // Project / offering pages root at their hub.
    const root =
      d.workspaceType === "EducationOffering"
        ? { label: "Education", to: "/education" }
        : { label: "Projects", to: "/projects" };
    const driveScope = d.workspaceType === "EducationOffering" ? "education" : "projects";
    return [
      root,
      {
        label: d.hubName,
        to: d.hubHref,
        icon:
          d.workspaceType === "EducationOffering" ? undefined : (
            <ProjectIcon iconEmoji={d.hubIconEmoji} />
          ),
      },
      ...(d.driveCrumbs?.folders ?? []).map((f) => ({
        label: f.title || "Untitled folder",
        to: `/drive?scope=${driveScope}&folder=${f.id}`,
        icon: <FolderIcon iconEmoji={f.iconEmoji} />,
      })),
      { label: d.title, icon: <WhiteboardCrumbIcon iconEmoji={d.iconEmoji} /> },
    ];
  },
};

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
      parentPageId: true,
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

  // Breadcrumb ancestry (mirrors the document viewer): the owning hub for
  // project/offering pages, plus the Drive folder path for nesting.
  let hubName: string | null = null;
  let hubHref: string | null = null;
  let hubIconEmoji: string | null = null;
  if (page.workspaceType === "Project" && page.workspaceId) {
    const project = await prisma.project.findUnique({
      where: { id: page.workspaceId },
      select: { name: true, iconEmoji: true },
    });
    if (project) {
      hubName = project.name;
      hubHref = `/projects/${page.workspaceId}`;
      hubIconEmoji = project.iconEmoji;
    }
  } else if (page.workspaceType === "EducationOffering" && page.workspaceId) {
    const offering = await prisma.educationOffering.findUnique({
      where: { id: page.workspaceId },
      select: { title: true },
    });
    if (offering) {
      hubName = offering.title;
      hubHref = `/education/${page.workspaceId}/hub`;
    }
  }
  const driveCrumbs = await driveFolderCrumbs(page.parentPageId, auth.user.sub, request);

  recordPageVisit(auth.user.sub, page.id, request);

  const collabToken = parseSessionCookie(request);
  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email;
  const presenceUser = await getPresenceUser(auth.user.sub, fallbackName);

  return {
    pageId: page.id,
    title: page.title,
    iconEmoji: page.iconEmoji,
    workspaceType: page.workspaceType,
    hubName,
    hubHref,
    hubIconEmoji,
    driveCrumbs,
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
