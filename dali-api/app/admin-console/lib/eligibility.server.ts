import { prisma } from "~/lib/db";
import type { Level } from "./eligibility";

// Server-only writers for DomainEligibility used by:
//   - admin-console/domains (per-domain Members cluster)
//   - members/$id profile (Domains & Levels section)
//
// promotedBy is stamped on every upsert/update so the audit trail follows
// the human who clicked, not the system (which is what staffing-finalize
// and decision-release already do).
//
// Client-safe items (Level type, ALLOWED_LEVELS, parseLevel) are in
// ./eligibility.ts — keep them imported from there in route components so
// React Router's *.server treeshake doesn't trip on client code.

export async function addOrUpdateEligibility(args: {
  userId: string;
  domainId: string;
  level: Level;
  actorId: string;
}) {
  return prisma.domainEligibility.upsert({
    where: {
      userId_domainId: { userId: args.userId, domainId: args.domainId },
    },
    update: { level: args.level, promotedBy: args.actorId, promotedAt: new Date() },
    create: {
      userId: args.userId,
      domainId: args.domainId,
      level: args.level,
      promotedBy: args.actorId,
    },
  });
}

export async function removeEligibility(args: { id: string }) {
  await prisma.domainEligibility.deleteMany({ where: { id: args.id } });
}
