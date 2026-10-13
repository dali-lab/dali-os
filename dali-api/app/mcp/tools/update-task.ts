// MCP `update_task` — edit fields on a task. Mirrors api.tasks.$id PATCH
// (Core or project member). Status changes go through `update_task_status`.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";
import { syncIssueForTask } from "~/projects/lib/github-task-sync";
import { notifyTaskAssigned } from "~/projects/lib/task-notifications.server";
import { activeSprintId, checkSprintTarget, resolveTaskPlacement } from "~/projects/lib/sprints.server";

const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

export const UPDATE_TASK_TOOL = {
  name: "update_task",
  description:
    "Edit fields on a project task (title, description, priority, epic, sprint, domain, assignees). Requires Core or project-member access. Status changes go through `update_task_status`. Omit a field to leave it unchanged. `sprintId` moves the task between weekly sprints: a sprint id from list_sprints, \"current\" for the active sprint, or empty string for the backlog. Every task keeps an epic, so `epicId` can be changed but not cleared. Tasks in a closed sprint are read-only unless being moved out.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taskId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 500 },
      description: {
        type: "string",
        description:
          "Plain-text / Markdown description. Empty string clears.",
      },
      priority: { type: "string", enum: PRIORITIES as unknown as string[] },
      epicId: { type: "string", minLength: 1, description: "Epic to move the task under." },
      sprintId: {
        type: "string",
        description:
          "Sprint id from list_sprints, \"current\" for the active sprint, or empty string for the backlog.",
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
  description?: string;
  priority?: Priority;
  epicId?: string;
  sprintId?: string;
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
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      projectId: true,
      githubIssueNumber: true,
      epicId: true,
      sprintId: true,
      status: true,
      sprint: { select: { closedAt: true } },
      assignees: { select: { userId: true } },
    },
  });
  if (!task) throw new UpdateTaskError("Task not found", 404);

  if (!(await canEditProject(callerId, task.projectId))) {
    throw new UpdateTaskError("Forbidden", 403);
  }

  let nextSprintId: string | null | undefined;
  if (input.sprintId === "current") {
    nextSprintId = await activeSprintId(task.projectId);
    if (!nextSprintId) throw new UpdateTaskError("No sprint is running on this project", 400);
  } else if (input.sprintId !== undefined) {
    nextSprintId = input.sprintId === "" ? null : input.sprintId;
  }
  const leavingClosed =
    nextSprintId !== undefined &&
    nextSprintId !== task.sprintId &&
    task.status !== "Done" &&
    task.status !== "Cancelled";
  if (task.sprint?.closedAt && !leavingClosed) {
    throw new UpdateTaskError("That sprint is closed", 409);
  }

  const data: {
    title?: string;
    description?: string | null;
    priority?: Priority;
    epicId?: string;
    sprintId?: string | null;
    domainId?: string | null;
  } = {};

  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (!trimmed) throw new UpdateTaskError("Title is required", 400);
    data.title = trimmed;
  }
  if (input.description !== undefined) {
    const trimmed = input.description.trim();
    data.description = trimmed === "" ? null : trimmed;
  }
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.epicId !== undefined && input.epicId !== task.epicId) {
    const placed = await resolveTaskPlacement(task.projectId, { epicId: input.epicId });
    if ("error" in placed) throw new UpdateTaskError(placed.error, 400);
    data.epicId = placed.epicId;
  }
  if (nextSprintId !== undefined && nextSprintId !== task.sprintId) {
    const err = await checkSprintTarget(task.projectId, nextSprintId);
    if (err) throw new UpdateTaskError(err.error, 400);
    data.sprintId = nextSprintId;
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
      await tx.task.update({ where: { id: input.taskId }, data: { ...data, activityAt: new Date() } });
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

  const syncableChanged =
    "title" in data ||
    "description" in data ||
    wantsAssignees ||
    "priority" in data ||
    "sprintId" in data ||
    "epicId" in data ||
    "domainId" in data;
  if (task.githubIssueNumber !== null && syncableChanged) {
    void syncIssueForTask(input.taskId).catch((err) =>
      console.error(`mcp update_task: github sync failed for ${input.taskId}`, err),
    );
  }

  if (wantsAssignees) {
    const priorIds = new Set(task.assignees.map((a) => a.userId));
    const added = (input.assigneeUserIds ?? []).filter((id) => !priorIds.has(id));
    if (added.length > 0) {
      void notifyTaskAssigned({
        taskId: input.taskId,
        addedUserIds: added,
        actorUserId: callerId,
      }).catch((err) =>
        console.error(`mcp update_task: assignment notify failed for ${input.taskId}`, err),
      );
    }
  }

  return { ok: true, taskId: input.taskId };
}
