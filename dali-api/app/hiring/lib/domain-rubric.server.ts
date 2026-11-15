import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";

export type SetDomainRubricResult = "ok" | "locked" | "rubric-not-found" | "not-in-cycle";

export async function setDomainRubric({
  cycleId,
  domainId,
  rubricVersionId,
  actorId,
  request,
}: {
  cycleId: string;
  domainId: string;
  rubricVersionId: string | null;
  actorId: string;
  request: Request;
}): Promise<SetDomainRubricResult> {
  const reviews = await prisma.applicationReview.count({
    where: { domainApplication: { domainId, application: { applicationCycleId: cycleId } } },
  });
  if (reviews > 0) return "locked";

  if (rubricVersionId) {
    const rubric = await prisma.rubricVersion.findUnique({ where: { id: rubricVersionId }, select: { id: true } });
    if (!rubric) return "rubric-not-found";
  }

  const key = { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } };
  const link = await prisma.domainApplicationCycle.findUnique({ where: key, select: { rubricVersionId: true } });
  if (!link) return "not-in-cycle";

  await prisma.domainApplicationCycle.update({ where: key, data: { rubricVersionId } });
  await logAuditEvent({
    action: "domain.rubric.set",
    userId: actorId,
    targetId: domainId,
    metadata: { cycleId, before: link.rubricVersionId ?? null, after: rubricVersionId },
    request,
  });
  return "ok";
}
