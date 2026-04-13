import type { Route } from "./+types/api.cycles.$cycleId.my-interviews.$interviewId.notes";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "PUT") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } });
  if (!member) {
    return withCors(request, Response.json({ error: "Not a DALI member" }, { status: 403 }));
  }

  const reviewer = await prisma.cycleReviewer.findFirst({
    where: { daliMemberId: member.id, applicationCycleId: params.cycleId },
  });
  if (!reviewer) {
    return withCors(request, Response.json({ error: "Not a reviewer for this cycle" }, { status: 403 }));
  }

  // Find the assignment for this reviewer on this interview
  const assignment = await prisma.interviewAssignment.findFirst({
    where: {
      interviewId: params.interviewId,
      cycleReviewerId: reviewer.id,
      status: "Active",
    },
  });
  if (!assignment) {
    return withCors(request, Response.json({ error: "Assignment not found" }, { status: 404 }));
  }

  const { notes } = await request.json();

  const updated = await prisma.interviewAssignment.update({
    where: { id: assignment.id },
    data: { notes },
  });

  return withCors(request, Response.json(updated));
}
