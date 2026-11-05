import type { prisma } from "~/lib/db.server";
import { normalizeRoles } from "./partner-renewals";
import { planSpotWrites } from "./planning-spots";

type Db = typeof prisma;

export type SetTermSpotsResult = "ok" | "unknown-domain" | "not-in-term";

export async function setTermSpots(
  db: Db,
  input: { projectId: string; termId: string; roles: { domainId: string; slots: number }[] },
): Promise<SetTermSpotsResult> {
  const roles = normalizeRoles(input.roles);
  if (roles.length) {
    const valid = await db.domain.findMany({
      where: { id: { in: roles.map((r) => r.domainId) }, active: true, isSystem: false },
      select: { id: true },
    });
    if (valid.length !== roles.length) return "unknown-domain";
  }
  return db.$transaction(async (tx) => {
    const term = await tx.projectTerm.findUnique({
      where: { projectId_termId: { projectId: input.projectId, termId: input.termId } },
      select: { id: true },
    });
    if (!term) return "not-in-term";
    const existing = await tx.projectRoleRequest.findMany({
      where: { projectId: input.projectId, termId: input.termId },
      select: { id: true, domainId: true, level: true, slots: true },
    });
    const writes = planSpotWrites(existing, roles);
    if (writes.deleteIds.length) {
      await tx.projectRoleRequest.deleteMany({ where: { id: { in: writes.deleteIds } } });
    }
    for (const u of writes.updates) {
      await tx.projectRoleRequest.update({ where: { id: u.id }, data: { slots: u.slots } });
    }
    if (writes.creates.length) {
      await tx.projectRoleRequest.createMany({
        data: writes.creates.map((c) => ({
          projectId: input.projectId,
          termId: input.termId,
          domainId: c.domainId,
          level: "P1" as const,
          slots: c.slots,
        })),
      });
    }
    return "ok";
  });
}
