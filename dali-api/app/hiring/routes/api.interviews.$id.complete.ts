import type { Route } from "./+types/api.interviews.$id.complete";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { parseJson } from "~/lib/validate";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";

const VALID_RECOMMENDATIONS = ["Strong Hire", "Hire", "Lean Hire", "Lean No Hire", "No Hire"] as const;

const CompleteSchema = z.object({
  recommendation: z.enum(VALID_RECOMMENDATIONS),
  recommendationNotes: z.string().max(10_000).optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST" && request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const member = await prisma.dALIMember.findUnique({ where: { userId: auth.user.sub } });
  if (!member) {
    return Response.json({ error: "Not a DALI member" }, { status: 403 });
  }

  // Verify the caller is an active interviewer on this interview
  const assignment = await prisma.interviewAssignment.findFirst({
    where: {
      interviewId: params.id,
      status: "Active",
      cycleInterviewer: { userId: auth.user.sub },
    },
  });
  if (!assignment) {
    return Response.json({ error: "You are not an active interviewer for this interview" }, { status: 403 });
  }

  const interview = await prisma.interview.findUnique({ where: { id: params.id } });
  if (!interview) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    interview.applicationCycleId,
  );
  if (gate) return gate;

  // DELETE = reopen a completed interview (flip status back to Scheduled).
  // Preserves recommendation + recommendationNotes so the interviewer can
  // re-submit the same values or edit them before marking complete again.
  if (request.method === "DELETE") {
    if (!(await isCore(auth.user.sub))) {
      return Response.json({ error: "Only hiring leads can reopen interviews" }, { status: 403 });
    }
    if (interview.status !== "Completed") {
      return Response.json({ error: "Interview is not completed" }, { status: 409 });
    }
    const updated = await prisma.interview.update({
      where: { id: params.id },
      data: { status: "Scheduled" },
    });
    await logAuditEvent({
      action: "interview.reopen",
      userId: auth.user.sub,
      targetId: interview.id,
      metadata: {
        cycleId: interview.applicationCycleId,
        domainApplicationId: interview.domainApplicationId,
      },
      request,
    });
    return Response.json(updated);
  }

  // POST = mark the interview complete.
  const body = await parseJson(request, CompleteSchema);
  if (body instanceof Response) return body;
  const { recommendation, recommendationNotes } = body;

  // The recommendation is joint: a single shared outcome for the interview, set
  // by either interviewer on behalf of both. So completing an already-completed
  // interview is idempotent, not an error — the co-interviewer may submit the
  // same (live-synced) value, or update it to the agreed value. We only record
  // an audit event on the first transition into Completed.
  const wasCompleted = interview.status === "Completed";

  const updated = await prisma.interview.update({
    where: { id: params.id },
    data: {
      status: "Completed",
      recommendation,
      recommendationNotes: recommendationNotes ?? null,
    },
  });

  if (!wasCompleted) {
    await logAuditEvent({
      action: "interview.complete",
      userId: auth.user.sub,
      targetId: interview.id,
      metadata: {
        cycleId: interview.applicationCycleId,
        domainApplicationId: interview.domainApplicationId,
        recommendation,
      },
      request,
    });
  }

  return Response.json(updated);
}
