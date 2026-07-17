import type { Route } from "./+types/api.scheduled-meetings.$id.check-in";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { markMeetingAttendance } from "~/lib/scheduled-meeting";

// POST /api/scheduled-meetings/:id/check-in
//
// Self-serve attendance for events too large to check off by hand (e.g. an
// all-lab Group meeting) — an alternative to the organizer/Core-facing
// AttendanceChecklist toggle route for meetings created with
// attendanceMode: "SelfCheckIn". The QR code / link shown on the meeting-note
// page just deep-links here with the meeting id; there is no token/secret
// checked server-side — the real authentication is the caller's own session,
// so a userId is always taken from auth.user.sub, never from the request
// body, and this can never mark someone else present.
const CHECK_IN_GRACE_MIN = 15;

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (auth.user.type === "applicant") return forbidden(request);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const meeting = await prisma.scheduledMeeting.findUnique({
    where: { id: params.id },
    select: { id: true, attendanceMode: true, selectedAt: true, durationMinutes: true },
  });
  if (!meeting || meeting.attendanceMode !== "SelfCheckIn") {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  if (!meeting.selectedAt) {
    return withCors(
      request,
      Response.json({ error: "This meeting doesn't have a scheduled time yet" }, { status: 400 }),
    );
  }

  const graceMs = CHECK_IN_GRACE_MIN * 60_000;
  const windowStart = meeting.selectedAt.getTime() - graceMs;
  const windowEnd = meeting.selectedAt.getTime() + meeting.durationMinutes * 60_000 + graceMs;
  const now = Date.now();
  if (now < windowStart || now > windowEnd) {
    return withCors(request, Response.json({ error: "Check-in window has closed" }, { status: 403 }));
  }

  const result = await markMeetingAttendance(meeting.id, auth.user.sub, true, auth.user.sub);
  if (!result.ok) {
    return withCors(request, Response.json({ error: result.error }, { status: result.status }));
  }
  return withCors(request, Response.json({ ok: true }));
}
