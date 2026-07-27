// Auto-archive job: sweeps tasks that have sat in a terminal status
// (Done / Cancelled) untouched past the configured threshold and stamps
// Task.archivedAt so they drop off the project board (the loader filters
// archivedAt: null). Rows are preserved, not deleted.
//
// Idempotent by construction: the `archivedAt: null` guard means a re-run
// (e.g. after a crashed lease) never re-archives an already-archived task,
// and a single bounded updateMany keeps per-tick work well under the lease.
//
// The project board's Archive button uses `archiveTerminalTasks` (no idle
// threshold) so managers clear Done/Cancelled off the board immediately;
// the weekly job keeps the age-gated sweep via `archiveIdleTasks`.

import { prisma } from "~/lib/db";
import { jobByName, resolveJobSettings } from "~/jobs/registry";
import type { JobContext, JobResult } from "~/jobs/registry";

const ARCHIVABLE_STATUSES = ["Done", "Cancelled"] as const;
const DEFAULT_ARCHIVE_AFTER_DAYS = 7;

export async function archiveIdleTasks(opts: {
  now: Date;
  archiveAfterDays: number;
  projectId?: string;
}): Promise<number> {
  const days = opts.archiveAfterDays;
  const cutoff = new Date(opts.now.getTime() - days * 24 * 60 * 60 * 1000);

  const { count } = await prisma.task.updateMany({
    where: {
      archivedAt: null,
      status: { in: [...ARCHIVABLE_STATUSES] },
      // updatedAt is bumped on any field edit, so this is "no activity since".
      updatedAt: { lt: cutoff },
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
    },
    data: { archivedAt: opts.now },
  });

  return count;
}

/** Archive every live Done/Cancelled task on a project, regardless of idle age. */
export async function archiveTerminalTasks(opts: {
  now: Date;
  projectId: string;
}): Promise<number> {
  const { count } = await prisma.task.updateMany({
    where: {
      projectId: opts.projectId,
      archivedAt: null,
      status: { in: [...ARCHIVABLE_STATUSES] },
    },
    data: { archivedAt: opts.now },
  });

  return count;
}

/** Resolve the operator-editable threshold (Admin → Jobs), falling back to default. */
export async function resolveArchiveAfterDays(): Promise<number> {
  const def = jobByName("task-auto-archive");
  if (!def) return DEFAULT_ARCHIVE_AFTER_DAYS;
  const row = await prisma.scheduledJob.findUnique({
    where: { name: "task-auto-archive" },
    select: { settings: true },
  });
  const settings = resolveJobSettings(def, row?.settings ?? null);
  return settings.archiveAfterDays ?? DEFAULT_ARCHIVE_AFTER_DAYS;
}

export async function runTaskAutoArchive({
  now,
  settings,
}: JobContext): Promise<JobResult> {
  const days = settings.archiveAfterDays ?? DEFAULT_ARCHIVE_AFTER_DAYS;
  const count = await archiveIdleTasks({ now, archiveAfterDays: days });

  return {
    items: count,
    note:
      count > 0
        ? `Archived ${count} Done/Cancelled task(s) idle >${days}d`
        : undefined,
  };
}
