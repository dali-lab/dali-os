// Scheduled form open/close: flips Form.published when an opensAt/closesAt
// boundary passes. Boundary-crossing semantics — each boundary is acted on
// exactly once, when it falls inside (lastSuccessAt, now]. An operator who
// publishes or unpublishes by hand after the boundary stays in charge; the
// job never revisits a boundary it already processed.

import { prisma } from "~/lib/db";
import { newPublicToken } from "~/forms/lib/forms-data";
import type { JobContext, JobResult } from "~/jobs/registry";

// First run (or a rebuilt jobs table) has no cursor; sweeping all history
// would republish long-dead forms, so look back one day at most.
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60_000;

export async function runFormWindows({
  now,
  lastSuccessAt,
}: JobContext): Promise<JobResult> {
  const since =
    lastSuccessAt ?? new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);

  // Opens before closes, so a window that opens and closes inside the same
  // gap ends closed.
  const toOpen = await prisma.form.findMany({
    where: { published: false, opensAt: { gt: since, lte: now } },
    select: { id: true, publicToken: true, _count: { select: { versions: true } } },
  });
  let opened = 0;
  let skipped = 0;
  for (const f of toOpen) {
    // Same rule as manual publish: no versions, nothing to serve.
    if (f._count.versions === 0) {
      skipped++;
      continue;
    }
    await prisma.form.update({
      where: { id: f.id },
      data: { published: true, publicToken: f.publicToken ?? newPublicToken() },
    });
    opened++;
  }

  const closed = await prisma.form.updateMany({
    where: { published: true, closesAt: { gt: since, lte: now } },
    data: { published: false },
  });

  return {
    items: opened + closed.count,
    note:
      `opened=${opened} closed=${closed.count}` +
      (skipped > 0 ? ` skippedNoVersions=${skipped}` : ""),
  };
}
