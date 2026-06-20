import type { Route } from "./+types/api.offerings.$id.decision-emails";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import type { EduApplicationStatus } from "~/generated/prisma/enums";

const VALID: EduApplicationStatus[] = ["Approved", "Rejected", "Waitlisted", "Submitted", "Withdrawn"];

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST" && request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await canManageOffering(auth.user.sub, params.id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const status = body?.status as EduApplicationStatus | undefined;
  if (!status || !VALID.includes(status)) {
    return Response.json({ error: `status must be one of ${VALID.join(", ")}` }, { status: 400 });
  }

  if (request.method === "DELETE") {
    await prisma.offeringDecisionEmail
      .delete({ where: { offeringId_status: { offeringId: params.id, status } } })
      .catch(() => {});
    return Response.json({ ok: true });
  }

  const versionId = typeof body.emailTemplateVersionId === "string" ? body.emailTemplateVersionId : null;
  if (!versionId) return Response.json({ error: "emailTemplateVersionId required" }, { status: 400 });

  const version = await prisma.emailTemplateVersion.findUnique({ where: { id: versionId } });
  if (!version) return Response.json({ error: "Template version not found" }, { status: 404 });

  const upserted = await prisma.offeringDecisionEmail.upsert({
    where: { offeringId_status: { offeringId: params.id, status } },
    update: { emailTemplateVersionId: versionId },
    create: { offeringId: params.id, status, emailTemplateVersionId: versionId },
  });

  await logAuditEvent({
    action: "education.offering.update",
    userId: auth.user.sub,
    targetId: params.id,
    metadata: { binding: "decisionEmail", status, versionId },
    request,
  });

  return Response.json(upserted);
}
