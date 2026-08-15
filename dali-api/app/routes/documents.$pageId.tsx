import { redirect, useLoaderData, useSearchParams } from "react-router";
import QRCode from "qrcode";
import type { Route } from "./+types/documents.$pageId";
import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";
import { fullName } from "~/lib/display";
import { getPresenceUser } from "~/lib/presence-user";
import { getPageAccess } from "~/lib/pageAccess.server";
import { isFavorited, recordPageVisit } from "~/lib/user-pages.server";
import { canManageSharing } from "~/lib/page-share-access.server";
import { normalizePageTypography } from "~/lib/page-typography";
import { driveFolderCrumbs } from "~/lib/drive-crumbs.server";
import { DocumentEditor } from "~/components/DocumentEditor";
import { AttendanceChecklist, type AttendanceRow } from "~/components/AttendanceChecklist";
import { CheckInPanel } from "~/components/CheckInPanel";
import { ProjectIcon } from "~/components/ProjectIcon";
import { PageIcon } from "~/components/PageIcon";
import { redirectToLogin } from "~/lib/login-next";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · DALI OS` : "Document · DALI OS" }];
};

// Not nested under /projects/:id or /education/:offeringId in the URL (this
// route is a standalone /documents/:pageId sibling), so Breadcrumbs can't pick
// up the owning workspace from a parent route match. Expand the leaf into the
// real trail back to the workspace hub — same fix as documents.file.$fileId.
// Falls back to a plain (unlinked) title for Lab-workspace pages, which have
// no dedicated hub to link to.
export const handle = {
  // Project/Education pages share the /documents/:pageId viewer, so their URL
  // root reads "Documents" while their real home is Projects/Education — those
  // declare the whole trail here. Lab pages (no workspace) genuinely live under
  // Documents and fall through to the leaf `breadcrumb` below.
  breadcrumbTrail: (data: unknown) => {
    const d = data as
      | {
          title?: string
          iconEmoji?: string | null
          hubName?: string
          hubHref?: string
          hubIconEmoji?: string | null
          workspaceType?: string
          driveCrumbs?: {
            scope: string
            folders: { id: string; title: string; iconEmoji: string | null }[]
          } | null
        }
      | undefined;
    if (!d?.title) return null;
    // Lab pages (no workspace hub) root at Drive, then walk the folder path so
    // nested docs keep their ancestry (Drive ▸ Folder ▸ … ▸ page).
    if (!d.hubName || !d.hubHref) {
      const scope = d.driveCrumbs?.scope ?? "lab";
      const scopeQuery = scope === "lab" ? "" : `?scope=${scope}`;
      return [
        { label: "Drive", to: `/drive${scopeQuery}` },
        ...(d.driveCrumbs?.folders ?? []).map((f) => ({
          label: f.title || "Untitled folder",
          to: `/drive?scope=${scope}&folder=${f.id}`,
          icon: <PageIcon iconEmoji={f.iconEmoji} />,
        })),
        { label: d.title, icon: <PageIcon iconEmoji={d.iconEmoji} /> },
      ];
    }
    const root =
      d.workspaceType === "EducationOffering"
        ? { label: "Education", to: "/education" }
        : { label: "Projects", to: "/projects" };
    return [
      root,
      {
        label: d.hubName,
        to: d.hubHref,
        // Project docs carry the project's emoji (or its neutral fallback glyph);
        // Education offerings have no project icon.
        icon:
          d.workspaceType === "EducationOffering" ? undefined : (
            <ProjectIcon iconEmoji={d.hubIconEmoji} />
          ),
      },
      // The leaf carries the page's own icon (emoji, or the neutral doc glyph).
      { label: d.title, icon: <PageIcon iconEmoji={d.iconEmoji} /> },
    ];
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
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
      parentPageId: true,
      archivedAt: true,
      meetingNoteId: true,
      iconEmoji: true,
      coverImageUrl: true,
      isTemplate: true,
      typography: true,
      updatedAt: true,
      createdById: true,
      partnerVisible: true,
      profileVisible: true,
      labListing: true,
      linkAccess: true,
      linkPermission: true,
      createdBy: { select: { firstName: true, lastName: true } },
      lastEditedBy: { select: { firstName: true, lastName: true } },
      tags: { select: { tag: { select: { id: true, label: true, slug: true, color: true } } } },
    },
  });
  // Mirrors the doc gate in authorizeCollabDoc: live page, any workspaceType.
  // Exception: meeting-note pages stay openable when archived — SelfCheckIn QR
  // / admin attendance deep-link to /documents/:id, and archiving the note from
  // the Documents hub must not break check-in for invitees.
  if (!page) {
    throw new Response("Not found", { status: 404 });
  }
  if (page.archivedAt !== null && !page.meetingNoteId) {
    throw new Response("Not found", { status: 404 });
  }

  // Unified permission resolution. Passing the full field set (createdById, the
  // general-access + note-visibility flags) makes this match the by-id path
  // exactly — the Lab branch keys off createdById/Core plus the General-access
  // and share layers. The Member read gate is folded in here (getPageAccess
  // handles notes), so there's no separate noteAccess pre-check.
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
  const { canEdit, canComment, canResolve } = access;
  if (!access.canView) throw new Response("Not found", { status: 404 });

  // After the gate, so a 404 never lands in someone's recents. Detached — a
  // failed bookkeeping write must not cost the reader their document.
  recordPageVisit(auth.user.sub, page.id, request);
  const favorited = await isFavorited(auth.user.sub, page.id);

  // Every workspace type now carries a shareable audience (named shares +
  // General access), so the Share button shows wherever the viewer may manage
  // it — the creator/Core on a lab doc, project staff, the note owner, an
  // instructor, or anyone granted Full access.
  const canManageAccess = await canManageSharing(
    {
      id: page.id,
      workspaceType: page.workspaceType,
      workspaceId: page.workspaceId,
      createdById: page.createdById,
    },
    auth.user.sub,
  );

  const allTags = await prisma.docTag.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
    select: { id: true, label: true, slug: true, color: true },
  });

  // Hub crumb for the breadcrumb trail (see handle.breadcrumb below). Lab
  // pages have no workspaceId and stay null — they fall back to a plain title.
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

  // Lab pages live in the Drive tree — resolve their folder ancestry so the
  // breadcrumb shows Drive ▸ Folder ▸ … ▸ page instead of just Drive ▸ page.
  const driveCrumbs =
    page.workspaceType === "Lab" ? await driveFolderCrumbs(page.parentPageId) : null;

  let attendance:
    | {
        meetingId: string;
        meetingLabel: string;
        canMark: boolean;
        rows: AttendanceRow[];
        selfCheckIn: boolean;
        viewerInvited: boolean;
        viewerPresent: boolean;
        checkInUrl: string | null;
        checkInQrSvg: string | null;
      }
    | null = null;
  if (page.meetingNoteId) {
    const meeting = await prisma.scheduledMeeting.findUnique({
      where: { id: page.meetingNoteId },
      select: {
        id: true,
        organizerId: true,
        meetingType: true,
        meetingTypeLabel: true,
        attendanceMode: true,
        attendance: {
          select: {
            userId: true,
            present: true,
            user: { select: { firstName: true, lastName: true, daliEmail: true } },
          },
        },
      },
    });
    if (meeting) {
      const label =
        meeting.meetingType === "Other"
          ? meeting.meetingTypeLabel || "Other"
          : (meeting.meetingType ?? "Meeting");
      const canMark = canEdit || auth.user.sub === meeting.organizerId;
      const viewerRow = meeting.attendance.find((a) => a.userId === auth.user.sub);
      const selfCheckIn = meeting.attendanceMode === "SelfCheckIn";

      // Only the organizer/Core need the QR/link to display at the event —
      // everyone else just sees the check-in button below if they scanned it.
      let checkInUrl: string | null = null;
      let checkInQrSvg: string | null = null;
      if (selfCheckIn && canMark) {
        const origin = new URL(request.url).origin;
        checkInUrl = `${origin}/documents/${page.id}`;
        checkInQrSvg = await QRCode.toString(checkInUrl, { type: "svg", margin: 1, width: 180 });
      }

      attendance = {
        meetingId: meeting.id,
        meetingLabel: label,
        canMark,
        rows: meeting.attendance.map((a) => ({
          userId: a.userId,
          name: fullName(a.user) || a.user.daliEmail || a.userId,
          present: a.present,
        })),
        selfCheckIn,
        viewerInvited: viewerRow !== undefined,
        viewerPresent: viewerRow?.present ?? false,
        checkInUrl,
        checkInQrSvg,
      };
    }
  }

  const collabToken = parseSessionCookie(request);
  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email;
  const presenceUser = await getPresenceUser(auth.user.sub, fallbackName);

  // Backlinks: pages that mention this page via a @pageMention inline node.
  const backlinkRows = await prisma.pageLink.findMany({
    where: { toPageId: page.id, fromPage: { archivedAt: null } },
    select: {
      fromPage: { select: { id: true, title: true, iconEmoji: true } },
    },
  });
  const backlinks = backlinkRows.map((r) => ({
    id: r.fromPage.id,
    title: r.fromPage.title,
    iconEmoji: r.fromPage.iconEmoji,
  }));

  return {
    pageId: page.id,
    title: page.title,
    workspaceType: page.workspaceType,
    workspaceId: page.workspaceId,
    hubName,
    hubHref,
    hubIconEmoji,
    driveCrumbs,
    iconEmoji: page.iconEmoji,
    coverImageUrl: page.coverImageUrl,
    isTemplate: page.isTemplate,
    typography: normalizePageTypography(page.typography),
    updatedAt: page.updatedAt.toISOString(),
    tags: page.tags.map((t) => t.tag).sort((a, b) => a.label.localeCompare(b.label)),
    allTags,
    canEdit,
    canComment,
    canResolve,
    canManageAccess,
    favorited,
    collabToken,
    userName: presenceUser?.name ?? fallbackName,
    currentUserId: auth.user.sub,
    photoUrl: presenceUser?.photoUrl ?? null,
    subtitle: presenceUser?.subtitle ?? null,
    attendance,
    backlinks,
  };
}

export default function DocumentPage() {
  const {
    pageId,
    title,
    workspaceType,
    workspaceId,
    tags,
    allTags,
    canEdit,
    canComment,
    canResolve,
    canManageAccess,
    favorited,
    collabToken,
    userName,
    currentUserId,
    photoUrl,
    subtitle,
    iconEmoji,
    coverImageUrl,
    isTemplate,
    typography,
    updatedAt,
    attendance,
    backlinks,
  } = useLoaderData() as Exclude<Awaited<ReturnType<typeof loader>>, Response>;

  // Arriving from a comment-mention notification (?comment=<id>): open the
  // comments panel and scroll to that comment once threads load.
  // Arriving from an @-mention notification (?mention=<userId>): scroll to and
  // flash the first mention chip for that user once the collab doc syncs.
  const [searchParams] = useSearchParams();
  const focusCommentId = searchParams.get("comment") ?? undefined;
  const focusMentionUserId = searchParams.get("mention") ?? undefined;

  return (
    <div className="flex flex-col gap-4">
      {attendance?.selfCheckIn && (
        <CheckInPanel
          meetingId={attendance.meetingId}
          meetingLabel={attendance.meetingLabel}
          viewerInvited={attendance.viewerInvited}
          initialPresent={attendance.viewerPresent}
          checkInUrl={attendance.checkInUrl}
          checkInQrSvg={attendance.checkInQrSvg}
        />
      )}
      {attendance && (
        <AttendanceChecklist
          meetingId={attendance.meetingId}
          meetingLabel={attendance.meetingLabel}
          canEdit={attendance.canMark}
          attendees={attendance.rows}
        />
      )}
      <DocumentEditor
        pageId={pageId}
        initialTitle={title}
        collabToken={collabToken}
        userName={userName}
        currentUserId={currentUserId}
        photoUrl={photoUrl}
        subtitle={subtitle}
        canEdit={canEdit}
        canComment={canComment}
        canResolve={canResolve}
        canManageAccess={canManageAccess}
        favorited={favorited}
        workspaceType={workspaceType}
        workspaceId={workspaceId}
        tags={tags}
        allTags={allTags}
        iconEmoji={iconEmoji}
        coverImageUrl={coverImageUrl}
        isTemplate={isTemplate}
        typography={typography}
        updatedAt={updatedAt}
        focusCommentId={focusCommentId}
        backlinks={backlinks}
        focusMentionUserId={focusMentionUserId}
        aiEnabled
      />
    </div>
  );
}
