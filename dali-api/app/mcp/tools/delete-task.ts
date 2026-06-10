// MCP `delete_task` — hard-delete a project task. Core-only.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";

export const DELETE_TASK_TOOL = {
  name: "delete_task",
  description:
    "Delete a project task (cascades to its assignees and comments). Core-only. Prefer setting status to Cancelled if the task should remain in history.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taskId: { type: "string", minLength: 1 },
    },
    required: ["taskId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { taskId: string };

export class DeleteTaskError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "DeleteTaskError";
  }
}

export async function runDeleteTask(callerId: string, input: Input) {
  if (!(await isCore(callerId))) {
    throw new DeleteTaskError("Forbidden", 403);
  }

  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { id: true },
  });
  if (!task) throw new DeleteTaskError("Task not found", 404);

  await prisma.$transaction([
    prisma.taskAssignee.deleteMany({ where: { taskId: input.taskId } }),
    prisma.taskComment.deleteMany({ where: { taskId: input.taskId } }),
    prisma.task.delete({ where: { id: input.taskId } }),
  ]);

  return { ok: true, taskId: input.taskId };
}
