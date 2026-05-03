import type { Route } from "./+types/api.interviews.$id.reassign";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

const ReassignSchema = z.object({
  assignmentId: z.string().min(1).max(100),
  newCycleInterviewerId: z.string().min(1).max(100),
});

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isHiringLead(auth.user.sub))) {
    return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const body = await parseJson(request, ReassignSchema);
  if (body instanceof Response) return withAuth(auth, body);
  const { assignmentId, newCycleInterviewerId } = body;

  const assignment = await prisma.interviewAssignment.findUnique({
    where: { id: assignmentId },
    include: { interview: true },
  });
  if (!assignment || assignment.interview.id !== params.id) {
    return withAuth(auth, Response.json({ error: "Assignment not found" }, { status: 404 }));
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

  return withAuth(auth, Response.json({ success: true }));
}
