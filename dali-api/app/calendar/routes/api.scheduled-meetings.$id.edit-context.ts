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
      guestEmails: true,
      externalEventId: true,
      location: true,
      description: true,
      rooms: { select: { id: true } },
    },
  });
  if (!meeting || meeting.status === "Cancelled") {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  if (meeting.organizerId !== auth.user.sub && !(await isCore(auth.user.sub, request))) {
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
        location: meeting.location,
        description: meeting.description,
        roomIds: meeting.rooms.map((r) => r.id),
        scopeType: meeting.scopeType,
        groupId: meeting.scopeType === "Group" ? meeting.scopeId : null,
        participantUserIds: meeting.participantUserIds,
        guestEmails: meeting.guestEmails,
        // Email guests are invited through the Google event, so they can only
        // be added while one exists.
        googleSynced: meeting.externalEventId !== null,
        organizerId: meeting.organizerId,
        // Inviting to a finished meeting adds to the roster without sending an
        // invite; the invite modal says so.
        upcoming: meetingIsUpcoming(meeting, new Date()),
      },
      options: { users, groups },
    }),
  );
}
