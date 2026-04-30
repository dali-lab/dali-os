import type { Route } from "./+types/api.interviews.$id.reassign";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { parseJson } from "~/lib/validate";

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

  return withAuth(auth, Response.json({ success: true }));
}
