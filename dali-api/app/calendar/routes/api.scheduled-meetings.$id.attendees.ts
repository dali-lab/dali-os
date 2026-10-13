import type { Route } from "./+types/api.scheduled-meetings.$id.attendees";
import { requireAuth, forbidden, isNonMember } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";

// GET /api/scheduled-meetings/:id/attendees
//
// Who is in a meeting, for filing suggestions on the Add-note modal. Same
// organizer-or-Core gate as edit-context, which is who can add a note.
export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (await isNonMember(auth, request)) return forbidden(request);

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.id! },
    select: { organizerId: true, participantUserIds: true, status: true },
  });
  if (!meeting || meeting.status === "Cancelled") {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  if (meeting.organizerId !== auth.user.sub && !(await isCore(auth.user.sub, request))) {
    return forbidden(request);
  }

  return withCors(
    request,
    Response.json({ organizerId: meeting.organizerId, participantUserIds: meeting.participantUserIds }),
  );
}
