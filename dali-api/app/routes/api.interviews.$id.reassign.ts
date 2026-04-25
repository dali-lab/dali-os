import type { Route } from "./+types/api.interviews.$id.reassign";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isHiringLead(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { assignmentId, newCycleInterviewerId } = await request.json();
  if (!assignmentId || !newCycleInterviewerId) {
    return Response.json({ error: "assignmentId and newCycleInterviewerId are required" }, { status: 400 });
  }

  const assignment = await prisma.interviewAssignment.findUnique({
    where: { id: assignmentId },
    include: { interview: true },
  });
  if (!assignment || assignment.interview.id !== params.id) {
    return Response.json({ error: "Assignment not found" }, { status: 404 });
  }

  const interview = assignment.interview;

  // Look up the new interviewer's member ID so we can check ALL their
  // CycleInterviewer rows for conflicts (a member can have multiple rows
  // across domains).
  const newCI = await prisma.cycleInterviewer.findUnique({
    where: { id: newCycleInterviewerId },
    select: { daliMemberId: true },
  });
  if (!newCI) {
    return Response.json({ error: "Interviewer not found" }, { status: 404 });
  }

  // Conflict check + reassign in one serializable transaction to prevent
  // two concurrent reassigns from both passing the overlap check.
  try {
    await prisma.$transaction(async (tx) => {
      const conflict = await tx.interviewAssignment.findFirst({
        where: {
          status: "Active",
          cycleInterviewer: { daliMemberId: newCI.daliMemberId },
          interview: {
            id: { not: interview.id },
            status: "Scheduled",
            startTime: { lt: interview.endTime },
            endTime: { gt: interview.startTime },
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

      await tx.interviewAssignment.create({
        data: {
          interviewId: assignment.interviewId,
          cycleInterviewerId: newCycleInterviewerId,
          role: assignment.role,
          status: "Active",
        },
      });
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

  return Response.json({ success: true });
}
