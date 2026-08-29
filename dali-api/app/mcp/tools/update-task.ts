// MCP `update_task` — edit fields on a task (title/priority/dueAt/sprintId/
// epicId/storyId/domainId/assignees). Mirrors api.tasks.$id PATCH (Core or project
// member). Use `update_task_status` for status changes (it has special
// column-rebalance semantics).

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";
import { syncIssueForTask } from "~/projects/lib/github-task-sync";
import { notifyTaskAssigned } from "~/projects/lib/task-notifications.server";

const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

export const UPDATE_TASK_TOOL = {
  name: "update_task",
  description:
    "Edit fields on a project task (title, priority, due date, sprint, epic, user story, domain, assignees). Requires Core or project-member access. Status changes go through `update_task_status`. Empty string clears nullable fields; omit a field to leave it unchanged. A story pins its epic — setting storyId also sets epicId; changing epicId drops a story that no longer fits.",
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
      storyId: {
        type: "string",
        description:
          "Parent user story. Pins the epic to the story's epic (overrides epicId). Empty string unlinks. A bare epicId change drops a now-orphaned story.",
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
  storyId?: string;
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
      storyId: true,
      assignees: { select: { userId: true } },
    },
  });
  if (!task) throw new UpdateTaskError("Task not found", 404);

  if (!(await canEditProject(callerId, task.projectId))) {
    throw new UpdateTaskError("Forbidden", 403);
  }

  const data: {
    title?: string;
    priority?: Priority;
    dueAt?: Date | null;
    sprintId?: string | null;
    epicId?: string | null;
    storyId?: string | null;
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
  // Sprint/epic reassignments are validated against the task's own project so
  // one project's editor can't attach the task to another project's board
  // (matches the web PATCH route's guard).
  if (input.sprintId !== undefined) {
    if (input.sprintId === "") {
      data.sprintId = null;
    } else {
      const sprint = await prisma.sprint.findUnique({
        where: { id: input.sprintId },
        select: { projectId: true },
      });
      if (!sprint || sprint.projectId !== task.projectId) {
        throw new UpdateTaskError("Sprint is not part of this project", 400);
      }
      data.sprintId = input.sprintId;
    }
  }
  // Epic and story reconcile together, never independently: a story pins its
  // epic (UserStory.epicId is required). An explicit story wins and sets the
  // epic; a bare epic change drops a now-orphaned story so the two can't
  // diverge (matches the web PATCH route). Empty string clears either.
  const epicInBody = input.epicId !== undefined;
  const storyInBody = input.storyId !== undefined;
  if (epicInBody || storyInBody) {
    const currentEpicId = task.epicId ?? null;
    const currentStoryId = task.storyId ?? null;
    let nextEpicId = epicInBody ? (input.epicId === "" ? null : input.epicId!) : currentEpicId;
    let nextStoryId = storyInBody ? (input.storyId === "" ? null : input.storyId!) : currentStoryId;

    if (nextStoryId !== null) {
      const story = await prisma.userStory.findUnique({
        where: { id: nextStoryId },
        select: { epicId: true, epic: { select: { projectId: true } } },
      });
      if (!story || story.epic.projectId !== task.projectId) {
        throw new UpdateTaskError("Story is not part of this project", 400);
      }
      if (storyInBody) {
        nextEpicId = story.epicId;
      } else if (nextEpicId !== story.epicId) {
        nextStoryId = null;
      }
    }

    if (nextStoryId === null && nextEpicId !== null && nextEpicId !== currentEpicId) {
      const epic = await prisma.epic.findUnique({
        where: { id: nextEpicId },
        select: { projectId: true },
      });
      if (!epic || epic.projectId !== task.projectId) {
        throw new UpdateTaskError("Epic is not part of this project", 400);
      }
    }

    if (nextEpicId !== currentEpicId) data.epicId = nextEpicId;
    if (nextStoryId !== currentStoryId) data.storyId = nextStoryId;
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

  // Re-sync when the title, assignees, or any body-rendered field changes
  // (see buildIssueBody in github-task-sync). This tool doesn't edit the
  // description, so that field isn't checked here.
  const syncableChanged =
    "title" in data ||
    wantsAssignees ||
    "priority" in data ||
    "dueAt" in data ||
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
