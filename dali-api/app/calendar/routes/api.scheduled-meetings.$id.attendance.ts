import type { Route } from "./+types/api.scheduled-meetings.$id.attendance";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";

// POST /api/scheduled-meetings/:id/attendance
//
// Toggle whether an invited participant was present at a meeting. Only
// meetings created with a meetingType + project (see createScheduledMeeting)
// have MeetingAttendance rows; this 404s otherwise. Keeps TimeEntry in sync:
// present -> upsert a Meeting-sourced TimeEntry for that user; not present ->
// delete it. Callers are the organizer or anyone with project-edit access on
// the meeting's project (same gate as editing the meeting-note document).

const BodySchema = z.object({
  userId: z.string().min(1),
  present: z.boolean(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (auth.user.type === "applicant") return forbidden(request);

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
      durationMinutes: true,
      selectedAt: true,
      createdAt: true,
    },
  });
  if (!meeting || !meeting.projectId) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }

  const [core, member] = await Promise.all([
    isCore(auth.user.sub),
    isProjectMember(auth.user.sub, meeting.projectId),
  ]);
  const canEdit = auth.user.sub === meeting.organizerId || core || member;
  if (!canEdit) return forbidden(request);

  const attendance = await prisma.meetingAttendance.findUnique({
    where: { scheduledMeetingId_userId: { scheduledMeetingId: meeting.id, userId: body.userId } },
  });
  if (!attendance) {
    return withCors(
      request,
      Response.json({ error: "User was not invited to this meeting" }, { status: 400 }),
    );
  }

  await prisma.meetingAttendance.update({
    where: { scheduledMeetingId_userId: { scheduledMeetingId: meeting.id, userId: body.userId } },
    data: {
      present: body.present,
      markedByUserId: auth.user.sub,
      markedAt: new Date(),
    },
  });

  if (body.present) {
    const startTime = meeting.selectedAt;
    const endTime = startTime
      ? new Date(startTime.getTime() + meeting.durationMinutes * 60_000)
      : null;
    await prisma.timeEntry.upsert({
      where: {
        scheduledMeetingId_userId: { scheduledMeetingId: meeting.id, userId: body.userId },
      },
      create: {
        userId: body.userId,
        source: "Meeting",
        scheduledMeetingId: meeting.id,
        projectId: meeting.projectId,
        date: startTime ?? meeting.createdAt,
        hours: meeting.durationMinutes / 60,
        startTime,
        endTime,
      },
      update: {
        projectId: meeting.projectId,
        date: startTime ?? meeting.createdAt,
        hours: meeting.durationMinutes / 60,
        startTime,
        endTime,
      },
    });
  } else {
    await prisma.timeEntry.deleteMany({
      where: { scheduledMeetingId: meeting.id, userId: body.userId },
    });
  }

  return withCors(request, Response.json({ ok: true }));
}
