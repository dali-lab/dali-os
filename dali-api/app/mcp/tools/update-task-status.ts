// MCP `update_task_status` — move a project Task to a different status. Lands
// the task at the end of the target column (same "append" semantics as the
// drag-to-end of board).
//
// Permission: the web board endpoint (`api.tasks.$id.move.ts`) gates moves to
// Core only. For MCP we additionally allow a task's own assignees to update
// status — the "list my tasks, mark mine done" flow is the primary value
// here. Anyone else (incl. non-Core members not assigned to the task) is
// rejected. Requires the `mcp:write` scope.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  TASK_STATUSES,
  type TaskStatus,
  isTaskStatus,
} from "~/projects/lib/task-board";

export const UPDATE_TASK_STATUS_TOOL = {
  name: "update_task_status",
  description:
    "Move a project task to a different status column (e.g. mark a task Done). Allowed for the task's assignees and for Core members.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taskId: {
        type: "string",
        minLength: 1,
        description: "Task.id, as returned by `list_my_tasks`.",
      },
      status: {
        type: "string",
        enum: TASK_STATUSES as unknown as string[],
        description: "Target status column.",
      },
    },
    required: ["taskId", "status"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { taskId: string; status: string };

export class UpdateTaskStatusError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "UpdateTaskStatusError";
  }
}

export async function runUpdateTaskStatus(callerId: string, input: Input) {
  if (!isTaskStatus(input.status)) {
    throw new UpdateTaskStatusError("Invalid status", 400);
  }
  const newStatus: TaskStatus = input.status;

  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      status: true,
      projectId: true,
      assignees: { select: { userId: true } },
    },
  });
  if (!task) throw new UpdateTaskStatusError("Task not found", 404);

  const isAssignee = task.assignees.some((a) => a.userId === callerId);
  const callerIsCore = isAssignee ? false : await isCore(callerId);
  if (!isAssignee && !callerIsCore) {
    throw new UpdateTaskStatusError("Forbidden", 403);
  }

  // Append to the end of the target column (same project, same status). Mirrors
  // the web `nextPositionInColumn` helper without round-tripping the whole board.
  const maxInCol = await prisma.task.aggregate({
    where: { projectId: task.projectId, status: newStatus },
    _max: { position: true },
  });
  const nextPosition = (maxInCol._max.position ?? -1) + 1;

  await prisma.task.update({
    where: { id: input.taskId },
    data: { status: newStatus, position: nextPosition },
  });

  return {
    ok: true,
    taskId: input.taskId,
    previousStatus: task.status,
    newStatus,
  };
}
