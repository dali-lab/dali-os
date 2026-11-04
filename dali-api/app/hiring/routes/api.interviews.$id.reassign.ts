import type { Route } from "./+types/api.interviews.$id.reassign";
import { z } from "zod";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { parseJson, idSchema } from "~/lib/validate";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { canOverrideAvailability, seatEligible } from "~/hiring/lib/interviewer-pool";
import { availabilityByInterview } from "~/hiring/lib/scheduling";
import { sendReassignmentEmails } from "~/hiring/lib/interview-emails";
import { syncInterviewMeetAttendees } from "~/hiring/lib/interview-meet";
import { notifyInterviewAssigned } from "~/hiring/lib/interview-notifications";
import { logAuditEvent } from "~/lib/audit";

const ReassignSchema = z.object({
  assignmentId: idSchema,
  newCycleInterviewerId: idSchema,
  override: z.boolean().optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJson(request, ReassignSchema);
  if (body instanceof Response) return body;
  const { assignmentId, newCycleInterviewerId, override = false } = body;

  const assignment = await prisma.interviewAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      interview: { include: { domainApplication: { select: { domainId: true } } } },
    },
  });
  if (!assignment || assignment.interview.id !== params.id) {
    return Response.json({ error: "Assignment not found" }, { status: 404 });
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    assignment.interview.applicationCycleId,
  );
  if (gate) return gate;

  const interview = assignment.interview;

  const roster = await prisma.cycleInterviewer.findMany({
    where: { applicationCycleId: interview.applicationCycleId, interviewRoundId: interview.interviewRoundId },
    select: { id: true, userId: true, domainId: true },
  });
  const newCI = roster.find((r) => r.id === newCycleInterviewerId);
  if (!newCI) {
    return Response.json({ error: "Interviewer not found" }, { status: 404 });
  }

  const seated = await prisma.interviewAssignment.findMany({
    where: { interviewId: interview.id, status: "Active" },
    select: { cycleInterviewer: { select: { userId: true } } },
  });
  const eligible = seatEligible(roster, {
    role: assignment.role,
    applicantDomainId: interview.domainApplication.domainId,
    seatedUserIds: seated.map((s) => s.cycleInterviewer.userId),
  });
  if (!eligible.some((r) => r.id === newCycleInterviewerId)) {
    return Response.json({ error: "This interviewer can't take this seat" }, { status: 400 });
  }

  // Calendars are read here, outside the transaction (see assignInterviewers).
  const availability =
    (await availabilityByInterview(interview.applicationCycleId, interview.interviewRoundId, [interview]))
      .get(interview.id)?.[newCI.userId] ?? "no-calendar";
  if (availability === "booked") {
    return Response.json(
      { error: "This interviewer is already assigned to another interview at this time" },
      { status: 409 },
    );
  }
  if (availability !== "free" && !(override && canOverrideAvailability(availability))) {
    return Response.json({ error: "This interviewer isn't free at this time", availability }, { status: 409 });
  }

  // Conflict check + reassign in one serializable transaction to prevent
  // two concurrent reassigns from both passing the overlap check.
  let newAssignmentId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const config = await tx.interviewConfig.findUnique({
        where: {
          applicationCycleId_interviewRoundId: {
            applicationCycleId: interview.applicationCycleId,
            interviewRoundId: interview.interviewRoundId,
          },
        },
      });
      const bufferMs = (config?.bufferMinutes ?? 15) * 60_000;
      const bufferedStart = new Date(interview.startTime.getTime() - bufferMs);
      const bufferedEnd = new Date(interview.endTime.getTime() + bufferMs);

      const conflict = await tx.interviewAssignment.findFirst({
        where: {
          status: "Active",
          cycleInterviewer: { userId: newCI.userId },
          interview: {
            id: { not: interview.id },
            status: "Scheduled",
            startTime: { lt: bufferedEnd },
            endTime: { gt: bufferedStart },
          },
        },
      });
      if (conflict) {
        throw new Error("__CONFLICT__");
      }

      await tx.interviewAssignment.update({
        where: { id: assignmentId },
        data: { status: "Replaced" },
      });

      const created = await tx.interviewAssignment.create({
        data: {
          interviewId: assignment.interviewId,
          cycleInterviewerId: newCycleInterviewerId,
          role: assignment.role,
          status: "Active",
        },
        select: { id: true },
      });
      newAssignmentId = created.id;
    }, { isolationLevel: "Serializable" });
  } catch (err: any) {
    if (err?.message === "__CONFLICT__") {
      return Response.json(
        { error: "This interviewer is already assigned to another interview at this time" },
        { status: 409 },
      );
    }
    throw err;
  }

  // Best-effort: notify old and new interviewers via email/calendar, and put
  // the replacement on the Meet event's guest list so they join without a knock.
  syncInterviewMeetAttendees(interview.id).catch(() => {});
  sendReassignmentEmails(
    interview.id,
    interview.domainApplicationId,
    assignment.cycleInterviewerId,
    newCycleInterviewerId,
  ).catch(() => {});
  if (newAssignmentId) {
    notifyInterviewAssigned({
      assignmentIds: [newAssignmentId],
      createdByUserId: auth.user.sub,
    }).catch(() => {});
  }

  await logAuditEvent({
    action: "interview.reassign",
    userId: auth.user.sub,
    targetId: interview.id,
    metadata: {
      cycleId: interview.applicationCycleId,
      oldCycleInterviewerId: assignment.cycleInterviewerId,
      newCycleInterviewerId,
      oldAssignmentId: assignmentId,
      newAssignmentId,
      ...(availability !== "free" && { calendarOverride: availability }),
    },
    request,
  });

  return Response.json({ success: true });
}
