// Signing-issuance job. Automates the termly re-issuance of recurring
// agreements: for each PerTerm document an admin has already put in force at
// least once, ensure a binding exists for the current term. Replaces the manual
// per-term "Put in force" click and, on a freshly materialized binding, fires
// the same proactive sign-request notification the admin activate flow does.
//
// Idempotent + bounded: it only touches PerTerm documents that already have a
// binding (proof of admin opt-in — it never auto-forces a never-activated doc),
// creates the current term's binding only when absent, and carries the version
// the admin last enforced (so publishing a newer draft mid-term never silently
// re-issues). Re-ticks find the binding present and do nothing.

import { prisma } from "~/lib/db";
import type { JobContext, JobResult } from "~/jobs/registry";
import { currentTerm } from "~/lib/roles";
import { notifySignRequest } from "~/signing/lib/notify.server";

export async function runSigningIssuance(_ctx: JobContext): Promise<JobResult> {
  const term = await currentTerm();
  if (!term) return { note: "no current term" };
  const scopeKey = `term:${term.id}`;

  // Recurring documents already activated at least once (≥1 binding). The most
  // recent binding names the version the admin last enforced — carry it forward.
  const docs = await prisma.signingDocument.findMany({
    where: {
      cadence: "PerTerm",
      archivedAt: null,
      bindings: { some: {} },
    },
    select: {
      id: true,
      bindings: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { versionId: true },
      },
    },
  });

  let created = 0;
  for (const doc of docs) {
    const versionId = doc.bindings[0]?.versionId;
    if (!versionId) continue;

    // Already issued for this term? (the common steady-state — a no-op tick)
    const existing = await prisma.signingBinding.findUnique({
      where: { documentId_scopeKey: { documentId: doc.id, scopeKey } },
      select: { id: true },
    });
    if (existing) continue;

    const binding = await prisma.signingBinding.create({
      data: { documentId: doc.id, versionId, scopeKey, termId: term.id },
      select: { id: true },
    });
    created++;
    await notifySignRequest(binding.id);
  }

  return {
    items: created,
    note: created > 0 ? `${created} binding(s) issued for ${term.code}` : undefined,
  };
}
