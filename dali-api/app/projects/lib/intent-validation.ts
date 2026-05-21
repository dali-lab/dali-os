// Persist a member's Intent-to-Work set for one cycle. Symmetric with
// replaceBidSet, but intent is self-declared: there's no eligibility /
// role-request gating — the interpreter already enforced the status enum and
// term membership. This is just the replace-whole-set write.

import { prisma } from "~/lib/db";
import type { RawIntent } from "./intent-form-interpreter";

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
