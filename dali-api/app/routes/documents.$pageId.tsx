import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/documents.$pageId";
import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";
import { isCore, isProjectMember } from "~/lib/roles";
import { fullName } from "~/lib/display";
import { getPresenceUser } from "~/lib/presence-user";
import { DocumentEditor } from "~/components/DocumentEditor";
import { AttendanceChecklist, type AttendanceRow } from "~/components/AttendanceChecklist";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · DALI OS` : "Document · DALI OS" }];
};

export const handle = {
  breadcrumb: (data: unknown) => (data as { title?: string } | undefined)?.title,
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
  // the collab handshake rejected members), plus the offering's instructors
  // for EducationOffering-workspace pages.
  let canEdit = await isCore(auth.user.sub);
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

  let attendance: { meetingId: string; meetingLabel: string; canMark: boolean; rows: AttendanceRow[] } | null =
    null;
  if (page.meetingNoteId) {
    const meeting = await prisma.scheduledMeeting.findUnique({
      where: { id: page.meetingNoteId },
      select: {
        id: true,
        organizerId: true,
        meetingType: true,
        meetingTypeLabel: true,
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
      attendance = {
        meetingId: meeting.id,
        meetingLabel: label,
        canMark: canEdit || auth.user.sub === meeting.organizerId,
        rows: meeting.attendance.map((a) => ({
          userId: a.userId,
          name: fullName(a.user) || a.user.daliEmail || a.userId,
          present: a.present,
        })),
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
    attendance,
  } = useLoaderData() as Exclude<Awaited<ReturnType<typeof loader>>, Response>;

  return (
    <div className="flex flex-col gap-4">
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
      />
    </div>
  );
}
