import type { Route } from "./+types/api.interviews.$id.reassign";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { sendReassignmentEmails } from "~/hiring/lib/interview-emails";
import { notifyInterviewAssigned } from "~/hiring/lib/interview-notifications";

const ReassignSchema = z.object({
  assignmentId: z.string().min(1).max(100),
  newCycleInterviewerId: z.string().min(1).max(100),
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
  const { assignmentId, newCycleInterviewerId } = body;

  const assignment = await prisma.interviewAssignment.findUnique({
    where: { id: assignmentId },
    include: { interview: true },
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

  // Look up the new interviewer's member ID so we can check ALL their
  // CycleInterviewer rows for conflicts (a member can have multiple rows
  // across domains).
  const newCI = await prisma.cycleInterviewer.findUnique({
    where: { id: newCycleInterviewerId },
    select: { userId: true },
  });
  if (!newCI) {
    return Response.json({ error: "Interviewer not found" }, { status: 404 });
  }

  // Conflict check + reassign in one serializable transaction to prevent
  // two concurrent reassigns from both passing the overlap check.
  let newAssignmentId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const config = await tx.interviewConfig.findUnique({
        where: { applicationCycleId: interview.applicationCycleId },
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

  // Best-effort: notify old and new interviewers via email/calendar
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

  return Response.json({ success: true });
}
