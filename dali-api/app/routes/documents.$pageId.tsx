import { redirect, useLoaderData, useSearchParams } from "react-router";
import QRCode from "qrcode";
import type { Route } from "./+types/documents.$pageId";
import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { fullName } from "~/lib/display";
import { getPresenceUser } from "~/lib/presence-user";
import { DocumentEditor } from "~/components/DocumentEditor";
import { AttendanceChecklist, type AttendanceRow } from "~/components/AttendanceChecklist";
import { CheckInPanel } from "~/components/CheckInPanel";
import { ProjectIcon } from "~/components/ProjectIcon";
import { PageIcon } from "~/components/PageIcon";

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
        }
      | undefined;
    if (!d?.title || !d.hubName || !d.hubHref) return null;
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
  breadcrumb: (data: unknown) => {
    const d = data as { title?: string; iconEmoji?: string | null } | undefined;
    if (!d?.title) return null;
    // Lab pages have no workspace trail — still show the page's own icon on the
    // leaf so it matches the document header.
    return [{ label: d.title, icon: <PageIcon iconEmoji={d.iconEmoji} /> }];
  },
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
      meetingNoteId: true,
      iconEmoji: true,
      coverImageUrl: true,
      updatedAt: true,
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

  // Mirrors the doc gate in authorizeCollabDoc: Core everywhere, plus anyone
  // staffed on the project for Project-workspace pages (the same gate the
  // document API routes use — without this the editor rendered enabled but
  // the collab handshake rejected members), plus the offering's instructors
  // for EducationOffering-workspace pages.
  let canEdit = await isCore(auth.user.sub);
  if (!canEdit && page.workspaceType === "Lab") {
    canEdit = await isLabMember(auth.user.sub);
  }
  if (!canEdit && page.workspaceType === "Project" && page.workspaceId) {
    canEdit = await isProjectMember(auth.user.sub, page.workspaceId);
  }
  if (!canEdit && page.workspaceType === "EducationOffering" && page.workspaceId) {
    const instructor = await prisma.instructorAssignment.findFirst({
      where: { userId: auth.user.sub, offeringId: page.workspaceId },
      select: { id: true },
    });
    canEdit = instructor !== null;
  }

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

  return {
    pageId: page.id,
    title: page.title,
    workspaceType: page.workspaceType,
    hubName,
    hubHref,
    hubIconEmoji,
    iconEmoji: page.iconEmoji,
    coverImageUrl: page.coverImageUrl,
    createdByName: page.createdBy ? fullName(page.createdBy) : null,
    lastEditedByName: page.lastEditedBy ? fullName(page.lastEditedBy) : null,
    updatedAt: page.updatedAt.toISOString(),
    tags: page.tags.map((t) => t.tag).sort((a, b) => a.label.localeCompare(b.label)),
    allTags,
    canEdit,
    collabToken,
    userName: presenceUser?.name ?? fallbackName,
    currentUserId: auth.user.sub,
    photoUrl: presenceUser?.photoUrl ?? null,
    subtitle: presenceUser?.subtitle ?? null,
    attendance,
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
    iconEmoji,
    coverImageUrl,
    createdByName,
    lastEditedByName,
    updatedAt,
    attendance,
  } = useLoaderData() as Exclude<Awaited<ReturnType<typeof loader>>, Response>;

  // Arriving from a mention notification (?mention=1): scroll to this reader's
  // own mention in the body once collab syncs.
  const [searchParams] = useSearchParams();
  const focusMentionUserId =
    searchParams.get("mention") === "1" ? currentUserId : undefined;
  const focusCommentId = searchParams.get("comment") ?? undefined;

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
        tags={tags}
        allTags={allTags}
        iconEmoji={iconEmoji}
        coverImageUrl={coverImageUrl}
        createdByName={createdByName}
        lastEditedByName={lastEditedByName}
        updatedAt={updatedAt}
        focusMentionUserId={focusMentionUserId}
        focusCommentId={focusCommentId}
      />
    </div>
  );
}
