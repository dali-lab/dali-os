import type { Route } from "./+types/api.applications.$id.decision";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { decide, type DecisionAction } from "~/lib/education/decisions";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const application = await prisma.educationApplication.findUnique({
    where: { id: params.id! },
    select: { offeringId: true },
  });
  if (!application) return Response.json({ error: "Not found" }, { status: 404 });
  const gate = await requireEducationManager(request, application.offeringId);
  if (!gate.ok) return gate.response;

  const body = (await request.json()) as {
    action: DecisionAction;
    reviewerNote?: string | null;
  };
  if (!["Approve", "Reject", "Waitlist"].includes(body.action)) {
    return Response.json({ error: "Invalid action" }, { status: 400 });
  }
  const result = await decide({
    applicationId: params.id!,
    action: body.action,
    actorUserId: gate.userId,
    reviewerNote: body.reviewerNote ?? null,
  });
  return Response.json(result);
}
