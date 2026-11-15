import { prisma } from "~/lib/db.server";
import type { TaskStatus } from "./task-board";
import { closeIssueForTask, syncIssueForTask } from "./github-task-sync";
import { nextColumnPosition } from "./task-position.server";
import { notifyTaskStatusChanged } from "./task-notifications.server";

export class TaskMoveError extends Error {
  constructor(
    message: string,
    public status: 400 | 404,
  ) {
    super(message);
    this.name = "TaskMoveError";
  }
}

export type MoveTaskArgs = {
  taskId: string;
  actorId: string;
  status: TaskStatus;
  orderedIds?: string[];
  position?: number;
};

export type MoveTaskResult = {
  taskId: string;
  projectId: string;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
  position: number;
};

export async function moveTask(args: MoveTaskArgs): Promise<MoveTaskResult> {
  const { taskId, actorId, status, orderedIds } = args;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, githubIssueNumber: true, projectId: true, status: true },
  });
  if (!task) throw new TaskMoveError("Task not found", 404);
  const changed = status !== task.status;

  let position: number;
  if (orderedIds !== undefined) {
    if (!orderedIds.includes(taskId)) {
      throw new TaskMoveError("orderedIds must include the moved task", 400);
    }
    const listed = await prisma.task.findMany({
      where: { id: { in: orderedIds } },
      select: { id: true, projectId: true },
    });
    if (listed.length !== orderedIds.length || listed.some((t) => t.projectId !== task.projectId)) {
      throw new TaskMoveError("orderedIds must be tasks of this project", 400);
    }
    const draggedData = changed ? { status, activityAt: new Date() } : {};
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.task.update({
          where: { id },
          data: id === taskId ? { ...draggedData, position: index } : { position: index },
        }),
      ),
    );
    position = orderedIds.indexOf(taskId);
  } else {
    position = args.position ?? (await nextColumnPosition(task.projectId, status));
    await prisma.task.update({
      where: { id: taskId },
      data: { status, position, ...(changed ? { activityAt: new Date() } : {}) },
    });
  }

  if (changed) {
    void notifyTaskStatusChanged(taskId, actorId, status).catch((err) =>
      console.error(`task ${taskId}: status notify failed`, err),
    );
  }

  if (task.githubIssueNumber !== null) {
    if (status === "Done") {
      void closeIssueForTask(taskId, "completed").catch((err) =>
        console.error(`task ${taskId}: github close failed`, err),
      );
    } else if (status === "Cancelled") {
      void closeIssueForTask(taskId, "not_planned").catch((err) =>
        console.error(`task ${taskId}: github close failed`, err),
      );
    } else {
      void syncIssueForTask(taskId).catch((err) =>
        console.error(`task ${taskId}: github sync failed`, err),
      );
    }
  }

  return { taskId, projectId: task.projectId, previousStatus: task.status as TaskStatus, newStatus: status, position };
}
