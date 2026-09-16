import type { Route } from "./+types/api.scheduled-meetings.$id.edit-context";
import { requireAuth, forbidden } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { loadParticipantOptions } from "./calendar.server";

// Everything the Edit-meeting modal needs, fetched on demand when the ⋯ menu's
// Edit is clicked — the meeting's current fields plus the member/group directory
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
    },
  });
  if (!meeting || meeting.status === "Cancelled") {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  // Same gate as the edit action: organizer or Core.
  if (meeting.organizerId !== auth.user.sub && !(await isCore(auth.user.sub, request))) {
    return forbidden(request);
  }

  const { users, groups } = await loadParticipantOptions(request);

  return withCors(
    request,
    Response.json({
      meeting: {
        id: meeting.id,
        title: meeting.title,
        startTime: meeting.selectedAt?.toISOString() ?? null,
        durationMinutes: meeting.durationMinutes,
        recurrenceRule: meeting.recurrenceRule,
        scopeType: meeting.scopeType,
        groupId: meeting.scopeType === "Group" ? meeting.scopeId : null,
        participantUserIds: meeting.participantUserIds,
      },
      options: { users, groups },
    }),
  );
}
