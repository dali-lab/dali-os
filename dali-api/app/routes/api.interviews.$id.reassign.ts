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

  await prisma.$transaction(async (tx) => {
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
  });

  return Response.json({ success: true });
}
