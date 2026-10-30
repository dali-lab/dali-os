// Persist a member's Intent-to-Work set for one cycle. Symmetric with
// replaceBidSet, but intent is self-declared: there's no eligibility /
// role-request gating — the interpreter already enforced the status enum and
// term membership. This is just the replace-whole-set write.

import { prisma } from "~/lib/db.server";
import { planIntentResync, type RawIntent } from "./intent-form-interpreter";
import type { ColumnMapping } from "./slot-roles";

// Replace-whole-set for (user, cycle): a resubmission is authoritative.
// Pass a transaction client so the caller composes it with the
// FormSubmission write + closeFormTodos atomically.
export async function replaceIntentSet(
  tx: Pick<typeof prisma, "intentToWork">,
  userId: string,
  staffingCycleId: string,
  rows: RawIntent[],
): Promise<void> {
  await tx.intentToWork.deleteMany({
    where: { userId, staffingCycleId },
  });
  if (rows.length > 0) {
    await tx.intentToWork.createMany({
      data: rows.map((r) => ({
        userId,
        staffingCycleId,
        termId: r.termId,
        status: r.status,
      })),
    });
  }
}

export async function resyncIntentSets(
  staffingCycleId: string,
  mapping: ColumnMapping,
): Promise<{ synced: number; failed: number }> {
  const [cycle, terms, submissions] = await Promise.all([
    prisma.staffingCycle.findUnique({ where: { id: staffingCycleId }, select: { termId: true } }),
    prisma.term.findMany({ select: { id: true } }),
    prisma.formSubmission.findMany({
      where: { staffingCycleId, slot: "intent-to-work", userId: { not: null } },
      select: { userId: true, answers: true },
    }),
  ]);
  const plan = planIntentResync(
    submissions.map((s) => ({ userId: s.userId!, answers: s.answers })),
    mapping,
    terms.map((t) => t.id),
    cycle?.termId ?? null,
  );
  await prisma.$transaction([
    prisma.intentToWork.deleteMany({
      where: { staffingCycleId, userId: { in: plan.sets.map((s) => s.userId) } },
    }),
    prisma.intentToWork.createMany({
      data: plan.sets.flatMap((s) =>
        s.rows.map((r) => ({ userId: s.userId, staffingCycleId, termId: r.termId, status: r.status })),
      ),
    }),
  ]);
  return { synced: plan.sets.length, failed: plan.failed };
}
