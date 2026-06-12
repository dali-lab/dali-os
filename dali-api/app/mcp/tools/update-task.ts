// MCP `update_task` — edit fields on a task (title/priority/dueAt/sprintId/
// epicId/domainId/assignees). Mirrors api.tasks.$id PATCH (Core-only). Use
// `update_task_status` for status changes (it has special column-rebalance
// semantics).

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { syncIssueForTask } from "~/projects/lib/github-task-sync";

const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

export const UPDATE_TASK_TOOL = {
  name: "update_task",
  description:
    "Edit fields on a project task (title, priority, due date, sprint, epic, domain, assignees). Core-only. Status changes go through `update_task_status`. Empty string clears nullable fields; omit a field to leave it unchanged.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taskId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 500 },
      priority: { type: "string", enum: PRIORITIES as unknown as string[] },
      dueAt: {
        type: "string",
        description: "ISO timestamp. Empty string clears.",
      },
      sprintId: {
        type: "string",
        description: "Sprint to move task into. Empty string = backlog.",
      },
      epicId: {
        type: "string",
        description: "Epic link. Empty string = unlinked.",
      },
      domainId: {
        type: "string",
        description: "Domain chip. Empty string = no domain.",
      },
      assigneeUserIds: {
        type: "array",
        items: { type: "string" },
        description: "Full replacement set. Empty array unassigns everyone.",
      },
    },
    required: ["taskId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  taskId: string;
  title?: string;
  priority?: Priority;
  dueAt?: string;
  sprintId?: string;
  epicId?: string;
  domainId?: string;
  assigneeUserIds?: string[];
};

export class UpdateTaskError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "UpdateTaskError";
  }
}

export async function runUpdateTask(callerId: string, input: Input) {
  if (!(await isCore(callerId))) {
    throw new UpdateTaskError("Forbidden", 403);
  }

  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { id: true, githubIssueNumber: true },
  });
  if (!task) throw new UpdateTaskError("Task not found", 404);

  const data: {
    title?: string;
    priority?: Priority;
    dueAt?: Date | null;
    sprintId?: string | null;
    epicId?: string | null;
    domainId?: string | null;
  } = {};

  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (!trimmed) throw new UpdateTaskError("Title is required", 400);
    data.title = trimmed;
  }
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.dueAt !== undefined) {
    if (input.dueAt === "") data.dueAt = null;
    else {
      const d = new Date(input.dueAt);
      if (!Number.isFinite(d.getTime())) {
        throw new UpdateTaskError("Invalid dueAt", 400);
      }
      data.dueAt = d;
    }
  }
  if (input.sprintId !== undefined) {
    data.sprintId = input.sprintId === "" ? null : input.sprintId;
  }
  if (input.epicId !== undefined) {
    data.epicId = input.epicId === "" ? null : input.epicId;
  }
  if (input.domainId !== undefined) {
    data.domainId = input.domainId === "" ? null : input.domainId;
  }

  const wantsAssignees = Array.isArray(input.assigneeUserIds);

  if (Object.keys(data).length === 0 && !wantsAssignees) {
    return { ok: true, taskId: input.taskId, noop: true };
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.task.update({ where: { id: input.taskId }, data });
    }
    if (wantsAssignees) {
      await tx.taskAssignee.deleteMany({ where: { taskId: input.taskId } });
      const ids = input.assigneeUserIds ?? [];
      if (ids.length > 0) {
        await tx.taskAssignee.createMany({
          data: ids.map((userId) => ({ taskId: input.taskId, userId })),
          skipDuplicates: true,
        });
      }
    }
  });

  const syncableChanged = "title" in data || wantsAssignees;
  if (task.githubIssueNumber !== null && syncableChanged) {
    void syncIssueForTask(input.taskId).catch((err) =>
      console.error(`mcp update_task: github sync failed for ${input.taskId}`, err),
    );
  }

  return { ok: true, taskId: input.taskId };
}
