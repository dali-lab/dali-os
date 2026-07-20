// Auto-archive job: sweeps tasks that have sat in a terminal status
// (Done / Cancelled) untouched past the configured threshold and stamps
// Task.archivedAt so they drop off the project board (the loader filters
// archivedAt: null). Rows are preserved, not deleted.
//
// Idempotent by construction: the `archivedAt: null` guard means a re-run
// (e.g. after a crashed lease) never re-archives an already-archived task,
// and a single bounded updateMany keeps per-tick work well under the lease.

import { prisma } from "~/lib/db";
import type { JobContext, JobResult } from "~/jobs/registry";

const ARCHIVABLE_STATUSES = ["Done", "Cancelled"] as const;

export async function runTaskAutoArchive({
  now,
  settings,
}: JobContext): Promise<JobResult> {
  const days = settings.archiveAfterDays ?? 30;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const { count } = await prisma.task.updateMany({
    where: {
      archivedAt: null,
      status: { in: [...ARCHIVABLE_STATUSES] },
      // updatedAt is bumped on any field edit, so this is "no activity since".
      updatedAt: { lt: cutoff },
    },
    data: { archivedAt: now },
  });

  return {
    items: count,
    note:
      count > 0
        ? `Archived ${count} Done/Cancelled task(s) idle >${days}d`
        : undefined,
  };
}
