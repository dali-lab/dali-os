import { prisma } from "~/lib/db.server";

export const ARCHIVABLE_STATUSES = ["Done", "Cancelled"] as const;

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
