import type { Route } from "./+types/api.submissions.$id.grade";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { gradeSubmission } from "~/education/lib/assignments-data";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const submission = await prisma.educationSubmission.findUnique({
    where: { id: params.id },
    select: { id: true, assignment: { select: { offeringId: true } } },
  });
  if (!submission?.assignment?.offeringId) {
    return Response.json({ error: "Submission not found" }, { status: 404 });
  }
  if (!(await canManageOffering(auth.user.sub, submission.assignment.offeringId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const feedback = typeof body?.feedback === "string" ? body.feedback : "";
  const graded = body?.graded !== false;

  try {
    const updated = await gradeSubmission({
      submissionId: params.id,
      feedback,
      graded,
      byUserId: auth.user.sub,
    });
    await logAuditEvent({
      action: "education.submission.grade",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: { graded, hasFeedback: feedback.trim().length > 0 },
      request,
    });
    return Response.json(updated);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Grade failed" },
      { status: 400 },
    );
  }
}
