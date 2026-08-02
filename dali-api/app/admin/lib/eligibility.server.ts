import { prisma } from "~/lib/db";
import type { Level } from "./eligibility";
import { notifyAdminsOfLevelAdvance } from "~/lib/promotion-notify.server";

// Server-only writers for DomainEligibility used by:
//   - admin/domains (per-domain Members cluster)
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

// Like addOrUpdateEligibility, but notifies admins when the change is a genuine
// pay-level *advancement* (issue #1001). Reads the prior level before the
// upsert so a brand-new eligibility (initial grant) stays silent. Use this at
// the advancement editors (Level Up, per-domain Members, profile Domains &
// Levels); the hiring/auto-promote path keeps addOrUpdateEligibility so a new
// hire's first P1 doesn't notify.
export async function applyEligibilityWithNotify(args: {
  userId: string;
  domainId: string;
  level: Level;
  actorId: string;
}) {
  const prior = await prisma.domainEligibility.findUnique({
    where: { userId_domainId: { userId: args.userId, domainId: args.domainId } },
    select: { level: true },
  });
  const row = await addOrUpdateEligibility(args);
  void notifyAdminsOfLevelAdvance({
    userId: args.userId,
    domainId: args.domainId,
    from: prior?.level ?? null,
    to: args.level,
    actorId: args.actorId,
  }).catch((err) => console.error("promotion notify (eligibility) failed", err));
  return row;
}

export async function removeEligibility(args: { id: string }) {
  await prisma.domainEligibility.deleteMany({ where: { id: args.id } });
}
