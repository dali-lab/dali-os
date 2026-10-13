import type { Route } from "./+types/api.scheduled-meetings.$id.attendance";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden, isNonMember } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { markMeetingAttendance, parseOccurrenceParam, tracksAttendance } from "~/lib/scheduled-meeting";

// POST /api/scheduled-meetings/:id/attendance
//
// Toggle whether an invited participant was present at one occurrence of a
// meeting (`occurrence`, omitted = the first). Only meetings that
// tracksAttendance() have MeetingAttendance rows; this 404s otherwise.
// The TimeEntry sync (upsert on present, delete otherwise) lives in
// markMeetingAttendance, shared with the self-check-in route. Callers are the
// organizer or anyone with project-edit access on the meeting's project (same
// gate as editing the meeting-note document) — project-less meetings (no
// projectId) fall back to Core-only, since there's no project membership to
// check.

const BodySchema = z.object({
  userId: z.string().min(1),
  present: z.boolean(),
  occurrence: z.string().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (await isNonMember(auth, request)) return forbidden(request);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      organizerId: true,
      projectId: true,
      meetingType: true,
      notebookId: true,
      attendanceMode: true,
      participantUserIds: true,
    },
  });
  if (!meeting || !tracksAttendance(meeting)) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }

  const [core, member] = await Promise.all([
    isCore(auth.user.sub),
    meeting.projectId ? isProjectMember(auth.user.sub, meeting.projectId) : Promise.resolve(false),
  ]);
  const canEdit = auth.user.sub === meeting.organizerId || core || member;
  if (!canEdit) return forbidden(request);

  const result = await markMeetingAttendance(
    meeting.id,
    body.userId,
    body.present,
    auth.user.sub,
    parseOccurrenceParam(body.occurrence),
  );
  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }
  return withCors(request, Response.json({ ok: true }));
}
