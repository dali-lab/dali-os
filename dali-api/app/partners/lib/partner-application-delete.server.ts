import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";

export type DeletePartnerApplicationResult =
  | { ok: true; id: string; title: string }
  | { ok: false; reason: "not-found" | "promoted"; message: string };

export async function deletePartnerApplication(
  applicationId: string,
  actorId: string,
  request?: Request,
): Promise<DeletePartnerApplicationResult> {
  const existing = await prisma.partnerApplication.findUnique({
    where: { id: applicationId },
    select: { id: true, title: true, stage: true, resultingProjectId: true },
  });
  if (!existing) {
    return { ok: false, reason: "not-found", message: "This application no longer exists." };
  }
  if (existing.resultingProjectId) {
    return { ok: false, reason: "promoted", message: "This application became a project, so it can't be deleted." };
  }
  await prisma.partnerApplication.delete({ where: { id: applicationId } });
  await logAuditEvent({
    action: "partner.application.delete",
    userId: actorId,
    targetId: applicationId,
    metadata: { title: existing.title, stage: existing.stage },
    request,
  });
  return { ok: true, id: applicationId, title: existing.title };
}
