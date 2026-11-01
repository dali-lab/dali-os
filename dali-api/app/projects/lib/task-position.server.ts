import { prisma } from "~/lib/db.server";
import type { TaskStatus } from "./task-board";

/** The position that lands a task last in a board column. */
export async function nextColumnPosition(projectId: string, status: TaskStatus): Promise<number> {
  const last = await prisma.task.findFirst({
    where: { projectId, status },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
}
