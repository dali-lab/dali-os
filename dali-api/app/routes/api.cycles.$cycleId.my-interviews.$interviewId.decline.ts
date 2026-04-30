import type { Route } from "./+types/api.cycles.$cycleId.my-interviews.$interviewId.decline";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { reassignInterviewer, isNoReplacementError } from "~/lib/scheduling";
import { requireApiSignedOrForbidden } from "~/lib/confidentiality";

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const gate = await requireApiSignedOrForbidden(auth.user.sub, params.cycleId!);
  if (gate) return withCors(request, gate);

  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } });
  if (!member) {
    return withCors(request, Response.json({ error: "Not a DALI member" }, { status: 403 }));
  }

  // A member can have multiple CycleInterviewer rows in the same cycle (one
  // per domain), so look up ALL of their rows and find any active assignment
  // on this interview under any of them.
  const interviewerRows = await prisma.cycleInterviewer.findMany({
    where: { daliMemberId: member.id, applicationCycleId: params.cycleId },
    select: { id: true },
  });
  if (interviewerRows.length === 0) {
    return withCors(request, Response.json({ error: "Not an interviewer for this cycle" }, { status: 403 }));
  }

  const assignment = await prisma.interviewAssignment.findFirst({
    where: {
      interviewId: params.interviewId,
      cycleInterviewerId: { in: interviewerRows.map((r) => r.id) },
      status: "Active",
    },
  });

  if (!assignment) {
    return withCors(request, Response.json({ error: "No active assignment found" }, { status: 404 }));
  }

  try {
    const result = await reassignInterviewer(params.interviewId!, assignment.id);
    return withCors(request, Response.json(result));
  } catch (err) {
    if (isNoReplacementError(err)) {
      return withCors(
        request,
        Response.json(
          {
            error:
              "No replacement interviewer is available for this slot. Please contact the hiring lead.",
          },
          { status: 409 },
        ),
      );
    }
    throw err;
  }
}
