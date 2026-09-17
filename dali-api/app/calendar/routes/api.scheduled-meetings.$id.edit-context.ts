import type { Route } from "./+types/api.scheduled-meetings.$id.edit-context";
import { requireAuth, forbidden } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { meetingIsUpcoming } from "~/lib/scheduled-meeting";
import { loadParticipantOptions } from "./calendar.server";

// Everything the Edit-meeting and Invite-people modals need, fetched on demand
// when one opens — the meeting's current fields plus the member/group directory
// for the guest picker. Kept off the Attendance loader so that page stays light.
export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (auth.user.type === "applicant") return forbidden(request);

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.id! },
    select: {
      id: true,
      title: true,
      organizerId: true,
      status: true,
      selectedAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      scopeType: true,
      scopeId: true,
      participantUserIds: true,
      guestsCanModify: true,
      guestsCanInviteOthers: true,
      guestsCanSeeGuestList: true,
    },
  });
  if (!meeting || meeting.status === "Cancelled") {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  // Widen to canGuestEdit: organizer, Core, or a participant with at least invite-others permission.
  const viewerIsCore = await isCore(auth.user.sub, request);
  const canFullEdit =
    meeting.organizerId === auth.user.sub ||
    viewerIsCore ||
    (meeting.guestsCanModify && meeting.participantUserIds.includes(auth.user.sub));
  const canGuestEdit =
    canFullEdit ||
    (meeting.guestsCanInviteOthers && meeting.participantUserIds.includes(auth.user.sub));
  const guestEditOnly = canGuestEdit && !canFullEdit;
  if (!canGuestEdit) {
    return forbidden(request);
  }

  const { users, groups } = await loadParticipantOptions(request);

  // Per-guest RSVP, from this meeting's invite notifications — shown as a dot on
  // each chip in the editor's guest picker. Latest response per user wins.
  const rsvpRows = await prisma.notification.findMany({
    where: { scheduledMeetingId: params.id!, rsvp: { not: null } },
    select: { recipientUserId: true, rsvp: true },
    orderBy: { rsvpAt: "desc" },
  });
  const responsesByUserId: Record<string, "Accepted" | "Declined" | "Tentative"> = {};
  for (const r of rsvpRows) {
    if (r.rsvp && !(r.recipientUserId in responsesByUserId)) {
      responsesByUserId[r.recipientUserId] = r.rsvp;
    }
  }

  return withCors(
    request,
    Response.json({
      responsesByUserId,
      meeting: {
        id: meeting.id,
        title: meeting.title,
        startTime: meeting.selectedAt?.toISOString() ?? null,
        durationMinutes: meeting.durationMinutes,
        recurrenceRule: meeting.recurrenceRule,
        scopeType: meeting.scopeType,
        groupId: meeting.scopeType === "Group" ? meeting.scopeId : null,
        participantUserIds: meeting.participantUserIds,
        organizerId: meeting.organizerId,
        // Inviting to a finished meeting adds to the roster without sending an
        // invite; the invite modal says so.
        upcoming: meetingIsUpcoming(meeting, new Date()),
        guestsCanModify: meeting.guestsCanModify,
        guestsCanInviteOthers: meeting.guestsCanInviteOthers,
        guestsCanSeeGuestList: meeting.guestsCanSeeGuestList,
        guestEditOnly,
        // Only the organizer (or Core) may change the permission flags.
        canSetPermissions: meeting.organizerId === auth.user.sub || viewerIsCore,
      },
      options: { users, groups },
    }),
  );
}
