import type { Route } from "./+types/api.offerings.$id.applications";
import { requireAuth } from "~/lib/auth";
import { submitApplication } from "~/education/lib/applications-data";
import { notifyApplicationStatus } from "~/education/lib/notifications";
import { logAuditEvent } from "~/lib/audit";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });
  const answers = Array.isArray(body.answers) ? body.answers : [];

  try {
    const result = await submitApplication({
      applicantUserId: auth.user.sub,
      offeringId: params.id,
      answers: answers.map((a: any) => ({
        questionId: String(a.questionId),
        content: String(a.content ?? ""),
      })),
    });

    const enrolledLink =
      auth.user.type === "applicant"
        ? `/portal/education/${params.id}/enrolled`
        : `/education/enrolled/${params.id}`;

    // Acknowledge submission. Auto-approval / waitlist emails are also sent
    // here because the status was decided at submission time.
    try {
      const { prisma } = await import("~/lib/db");
      const offering = await prisma.educationOffering.findUnique({
        where: { id: params.id },
        select: { title: true },
      });
      if (offering) {
        await notifyApplicationStatus({
          applicantUserId: auth.user.sub,
          offeringTitle: offering.title,
          status: result.status,
          offeringId: params.id,
          enrolledLink: result.status === "Approved" ? enrolledLink : null,
          reason: "decision",
        });
      }
    } catch (err) {
      console.error("[education] post-submit notify failed:", err);
    }

    await logAuditEvent({
      action: "education.application.submit",
      userId: auth.user.sub,
      targetId: result.applicationId,
      metadata: { offeringId: params.id, status: result.status },
      request,
    });

    return Response.json(result, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Submit failed" },
      { status: 400 },
    );
  }
}
