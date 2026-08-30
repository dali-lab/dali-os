import type { Route } from "./+types/api.my-interview.cancel";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { idSchema, parseJson } from "~/lib/validate";
// import { deprovisionZoomMeeting } from "~/lib/zoom"; // S2S Zoom not configured yet
import { deprovisionInterviewMeet } from "~/hiring/lib/interview-meet";
import { sendInterviewCancelEmails } from "~/hiring/lib/interview-emails";

const CancelSchema = z.object({
  domainApplicationId: idSchema,
});

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, CancelSchema);
  if (body instanceof Response) return withCors(request, body);
  const { domainApplicationId } = body;

  const interview = await prisma.interview.findFirst({
    where: {
      domainApplicationId,
      domainApplication: { application: { userId: auth.user.sub } },
      status: "Scheduled",
    },
  });

  if (!interview) {
    return withCors(request, Response.json({ error: "No active interview found" }, { status: 404 }));
  }

  const config = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: interview.applicationCycleId },
  });
  const cancelNoticeHours = config?.cancelNoticeHours ?? 0;
  if (cancelNoticeHours > 0) {
    const cutoff = new Date(interview.startTime.getTime() - cancelNoticeHours * 60 * 60_000);
    if (new Date() > cutoff) {
      return withCors(request, Response.json(
        { error: "Too late to cancel — please contact the DALI team" },
        { status: 403 },
      ));
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const interviewUpdate = await tx.interview.update({
      where: { id: interview.id },
      data: { status: "CancelledByApplicant" },
    });
    await tx.interviewAssignment.updateMany({
      where: { interviewId: interview.id, status: "Active" },
      data: { status: "Declined" },
    });
    return interviewUpdate;
  });

  // Tear down the Google Meet link / hiring-calendar event. Best-effort no-op
  // when the interview never had one. Zoom S2S (app/lib/zoom.ts) stays dormant.
  await deprovisionInterviewMeet({ id: interview.id, calendarEventId: interview.calendarEventId });

  // Best-effort: send cancellation ICS to applicant + interviewers
  sendInterviewCancelEmails(interview.id, domainApplicationId).catch(() => {});

  return withCors(request, Response.json(updated));
}
