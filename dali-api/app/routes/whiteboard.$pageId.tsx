import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/whiteboard.$pageId";
import { prisma } from "~/lib/db.server";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getCollabToken } from "~/lib/collab-token.server";
import { getPresenceUser } from "~/lib/presence-user.server";
import { PAGE_ACCESS_SELECT, getPageAccess } from "~/lib/pageAccess.server";
import { recordPageVisit } from "~/lib/user-pages.server";
import { canManageSharing } from "~/lib/page-share-access.server";
import { drivePageTrail, type DrivePageAncestry } from "~/components/drive/drive-page-trail";
import { loadDrivePageAncestry } from "~/drive/lib/drive-page-trail.server";
import { Shapes } from "lucide-react";
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
    const d = data as (Partial<DrivePageAncestry> & { iconEmoji?: string | null }) | undefined;
    return drivePageTrail(d, <WhiteboardCrumbIcon iconEmoji={d?.iconEmoji} />);
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const page = await prisma.page.findUnique({
    where: { id: params.pageId },
    select: {
      ...PAGE_ACCESS_SELECT,
      title: true,
      kind: true,
      iconEmoji: true,
      // When this board is a meeting's whiteboard, carry the meeting + its note
      // so the canvas can show a context bar linking across to them.
      meetingWhiteboard: {
        // The board is one per series, so it links to the latest note.
        select: {
          id: true,
          title: true,
          location: true,
          selectedAt: true,
          createdAt: true,
          rooms: { select: { name: true }, orderBy: { name: "asc" } },
          notePages: {
            select: { id: true, meetingOccurrenceStart: true },
            orderBy: { meetingOccurrenceStart: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (!page || page.archivedAt !== null) {
    throw new Response("Not found", { status: 404 });
  }
  // A non-whiteboard page reached via this URL belongs in the document editor.
  if (page.kind !== "Whiteboard") {
    return redirect(`/documents/${page.id}`);
  }

  const access = await getPageAccess(auth.user.sub, page);
  if (!access.canView) throw new Response("Not found", { status: 404 });

  // Breadcrumb ancestry (mirrors the document viewer).
  const ancestry = await loadDrivePageAncestry(page, auth.user.sub, request);

  recordPageVisit(auth.user.sub, page.id, request);

  const wb = page.meetingWhiteboard;
  const note = wb?.notePages[0] ?? null;
  const occurrenceStart = note?.meetingOccurrenceStart ?? wb?.selectedAt ?? wb?.createdAt ?? null;
  const attendanceRows =
    wb && note?.meetingOccurrenceStart
      ? await prisma.meetingAttendance.findMany({
          where: { scheduledMeetingId: wb.id, occurrenceStart: note.meetingOccurrenceStart },
          select: { present: true },
        })
      : null;
  const canManageAccess = await canManageSharing(
    { id: page.id, workspaceType: page.workspaceType, workspaceId: page.workspaceId, createdById: page.createdById },
    auth.user.sub,
  );

  const collabToken = await getCollabToken(request);
  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email;
  const presenceUser = await getPresenceUser(auth.user.sub, fallbackName);

  return {
    pageId: page.id,
    ...ancestry,
    canEdit: access.canEdit,
    collabToken,
    userName: presenceUser?.name ?? fallbackName,
    currentUserId: auth.user.sub,
    photoUrl: presenceUser?.photoUrl ?? null,
    canManageAccess,
    workspaceType: page.workspaceType,
    meeting: wb
      ? {
          id: wb.id,
          title: wb.title,
          notePageId: note?.id ?? null,
          startIso: occurrenceStart ? occurrenceStart.toISOString() : null,
          location: wb.location,
          roomNames: wb.rooms.map((r) => r.name),
          attendance: attendanceRows
            ? { attended: attendanceRows.filter((r) => r.present).length, expected: attendanceRows.length }
            : null,
        }
      : null,
  };
}

export default function WhiteboardPage() {
  const data = useLoaderData<typeof loader>();
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
      canManageAccess={data.canManageAccess}
      workspaceType={data.workspaceType}
      meeting={data.meeting}
    />
  );
}
