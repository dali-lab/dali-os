import type { Route } from "./+types/api.cycles.$cycleId.my-interviews.$interviewId.decline";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { reassignReviewer } from "~/lib/scheduling";

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } });
  if (!member) {
    return withCors(request, Response.json({ error: "Not a DALI member" }, { status: 403 }));
  }

  const reviewer = await prisma.cycleReviewer.findUnique({
    where: { daliMemberId_applicationCycleId: { daliMemberId: member.id, applicationCycleId: params.cycleId } },
  });
  if (!reviewer) {
    return withCors(request, Response.json({ error: "Not a reviewer" }, { status: 403 }));
  }

  // Find the active assignment for this reviewer on this interview
  const assignment = await prisma.interviewAssignment.findFirst({
    where: {
      interviewId: params.interviewId,
      cycleReviewerId: reviewer.id,
      status: "Active",
    },
  });

  if (!assignment) {
    return withCors(request, Response.json({ error: "No active assignment found" }, { status: 404 }));
  }

  const result = await reassignReviewer(params.interviewId, assignment.id);

  return withCors(request, Response.json(result));
}
