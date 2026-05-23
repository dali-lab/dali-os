import { prisma } from "~/lib/db";

export type Level = "P1" | "P2" | "P3";

// Shared writers for DomainEligibility used by:
//   - admin-console/domains (per-domain Members cluster)
//   - members/$id profile (Domains & Levels section)
//
// promotedBy is stamped on every upsert/update so the audit trail follows
// the human who clicked, not the system (which is what staffing-finalize
// and decision-release already do).

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

export const ALLOWED_LEVELS: Level[] = ["P1", "P2", "P3"];

export function parseLevel(raw: unknown): Level | null {
  if (typeof raw !== "string") return null;
  return (ALLOWED_LEVELS as string[]).includes(raw) ? (raw as Level) : null;
}
