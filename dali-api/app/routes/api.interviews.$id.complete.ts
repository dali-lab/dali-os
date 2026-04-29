import type { Route } from "./+types/api.interviews.$id.complete";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { safeJson } from "~/lib/safe-json";

const VALID_RECOMMENDATIONS = ["Strong Hire", "Hire", "Lean Hire", "Lean No Hire", "No Hire"];

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST" && request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const member = await prisma.dALIMember.findFirst({ where: { userId: auth.user.sub } });
  if (!member) {
    return Response.json({ error: "Not a DALI member" }, { status: 403 });
  }

  // Verify the caller is an active interviewer on this interview
  const assignment = await prisma.interviewAssignment.findFirst({
    where: {
      interviewId: params.id,
      status: "Active",
      cycleInterviewer: { daliMemberId: member.id },
    },
  });
  if (!assignment) {
    return Response.json({ error: "You are not an active interviewer for this interview" }, { status: 403 });
  }

  const interview = await prisma.interview.findUnique({ where: { id: params.id } });
  if (!interview) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }

  // DELETE = reopen a completed interview (flip status back to Scheduled).
  // Preserves recommendation + recommendationNotes so the interviewer can
  // re-submit the same values or edit them before marking complete again.
  if (request.method === "DELETE") {
    if (interview.status !== "Completed") {
      return Response.json({ error: "Interview is not completed" }, { status: 409 });
    }
    const updated = await prisma.interview.update({
      where: { id: params.id },
      data: { status: "Scheduled" },
    });
    return Response.json(updated);
  }

  // POST = mark the interview complete.
  const body = await safeJson<{ recommendation?: string; recommendationNotes?: string }>(request);
  if (body instanceof Response) return body;
  const { recommendation, recommendationNotes } = body;

  if (!recommendation || !VALID_RECOMMENDATIONS.includes(recommendation)) {
    return Response.json(
      { error: `recommendation is required and must be one of: ${VALID_RECOMMENDATIONS.join(", ")}` },
      { status: 400 },
    );
  }

  if (interview.status === "Completed") {
    return Response.json({ error: "Interview is already completed" }, { status: 409 });
  }

  const updated = await prisma.interview.update({
    where: { id: params.id },
    data: {
      status: "Completed",
      recommendation,
      recommendationNotes: recommendationNotes ?? null,
    },
  });

  return Response.json(updated);
}
