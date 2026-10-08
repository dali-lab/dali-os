import type { Route } from "./+types/api.interviews.$id.cancel";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { parseJson } from "~/lib/validate";
import { deprovisionInterviewMeet } from "~/hiring/lib/interview-meet";
import { sendInterviewCancelEmails } from "~/hiring/lib/interview-emails";
import { notifyInterviewCancelled } from "~/hiring/lib/interview-notifications";
import { releaseInterviewRoom } from "~/hiring/lib/scheduling";

const CancelSchema = z.object({
  // Off when the lead has already spoken with the applicant.
  notifyApplicant: z.boolean().default(true),
});

// POST /api/hiring/interviews/:id/cancel — Core only. Unlike the applicant's
// own cancel this has no notice window and is not a withdrawal: the status
// derivation ignores CancelledByAdmin, so the applicant goes back to
// "invited" and can book a new time.
export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Only hiring leads can cancel interviews" }, { status: 403 });
  }

  const body = (request.headers.get("content-type") ?? "").includes("application/json")
    ? await parseJson(request, CancelSchema)
    : CancelSchema.parse({});
  if (body instanceof Response) return body;

  const interview = await prisma.interview.findUnique({
    where: { id: params.id },
    include: {
      roomBooking: { select: { userId: true } },
      assignments: {
        where: { status: "Active" },
        select: { cycleInterviewer: { select: { userId: true } } },
      },
    },
  });
  if (!interview) return Response.json({ error: "Interview not found" }, { status: 404 });
  if (interview.status !== "Scheduled") {
    return Response.json({ error: "Only scheduled interviews can be cancelled" }, { status: 409 });
  }

  const interviewerUserIds = interview.assignments.map((a) => a.cycleInterviewer.userId);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.interview.update({
      where: { id: interview.id },
      data: { status: "CancelledByAdmin" },
    });
    await tx.interviewAssignment.updateMany({
      where: { interviewId: interview.id, status: "Active" },
      data: { status: "Declined" },
    });
    await releaseInterviewRoom(interview, tx);
    return row;
  });

  await deprovisionInterviewMeet({ id: interview.id, calendarEventId: interview.calendarEventId });

  await logAuditEvent({
    action: "interview.cancel",
    userId: auth.user.sub,
    targetId: interview.id,
    metadata: {
      by: "admin",
      cycleId: interview.applicationCycleId,
      domainApplicationId: interview.domainApplicationId,
      startTime: interview.startTime.toISOString(),
      notifyApplicant: body.notifyApplicant,
    },
    request,
  });

  // Best-effort after commit: ICS cancellations by email, in-app tile for the
  // interviewers. Interviewers always hear; the applicant email is optional.
  sendInterviewCancelEmails(interview.id, interview.domainApplicationId, {
    byTeam: true,
    skipApplicant: !body.notifyApplicant,
  }).catch(() => {});
  notifyInterviewCancelled({
    interviewId: interview.id,
    interviewerUserIds,
    createdByUserId: auth.user.sub,
  }).catch(() => {});

  return Response.json(updated);
}
