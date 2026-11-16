// MCP `delete_task` — hard-delete a project task. Core or project member.

import { prisma } from "~/lib/db.server";
import { canEditProject } from "./access";
import type { McpCtx } from "../registry";
import { deleteTask } from "~/projects/lib/task-update.server";

type Input = { taskId: string };

export class DeleteTaskError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "DeleteTaskError";
  }
}

export async function runDeleteTask(callerId: string, input: Input, ctx?: Pick<McpCtx, "request">) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { id: true, projectId: true },
  });
  if (!task) throw new DeleteTaskError("Task not found", 404);

  if (!(await canEditProject(callerId, task.projectId))) {
    throw new DeleteTaskError("Forbidden", 403);
  }

  await deleteTask({ taskId: input.taskId, actorId: callerId, request: ctx?.request });

  return { ok: true, taskId: input.taskId };
}
