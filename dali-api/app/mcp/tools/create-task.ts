// MCP `create_task` — create a Task on a project. Mirrors
// api.projects.$id.tasks (Core or project member). Optionally mirrors to GitHub.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";
import { BOARD_STATUSES, isTaskStatus } from "~/projects/lib/task-board";
import {
  activeSprintId,
  openSprintForDay,
  resolveTaskPlacement,
} from "~/projects/lib/sprints.server";
import { utcDayOf } from "~/projects/lib/timeline-days";
import { createIssueForTask, normalizeRepo } from "~/projects/lib/github-task-sync";
import { notifyTaskAssigned } from "~/projects/lib/task-notifications.server";

const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

export const CREATE_TASK_TOOL = {
  name: "create_task",
  description:
    "Create a project task. Requires Core or project-member access. Every task belongs to an epic (omit `epicId` to file it under the project's General epic) and to one weekly sprint or the backlog: pass a `sprintId` from list_sprints, \"current\" for the active sprint, or omit for the backlog. Tasks have no due dates. Optionally mirrors to a GitHub issue (`mirrorToGithubRepo` must be one of the project's repoUrls).",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 500 },
      description: {
        type: "string",
        description: "Optional plain-text / Markdown description.",
      },
      status: {
        type: "string",
        enum: BOARD_STATUSES as unknown as string[],
        description: "Defaults to 'Todo'.",
      },
      priority: { type: "string", enum: PRIORITIES as unknown as string[] },
      epicId: {
        type: "string",
        description: "Epic to file the task under. Omit for the project's General epic.",
      },
      sprintId: {
        type: "string",
        description:
          "Sprint id from list_sprints, or \"current\" for the active sprint. Omit for the backlog. Closed sprints are rejected.",
      },
      domainId: { type: "string", description: "Optional domain chip." },
      assigneeUserIds: {
        type: "array",
        items: { type: "string" },
        description: "User ids to assign. Omit or empty for unassigned.",
      },
      mirrorToGithubRepo: {
        type: "string",
        description:
          "If set, mirror this task to a GitHub issue in the given repo (must appear in the project's repoUrls). Empty string disables.",
      },
    },
    required: ["projectId", "title"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  projectId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: Priority;
  epicId?: string;
  sprintId?: string;
  domainId?: string;
  /** Internal (meeting action items): a calendar day; the task lands in the
   *  open sprint containing it. Ignored when sprintId is given. */
  forDay?: string;
  assigneeUserIds?: string[];
  mirrorToGithubRepo?: string;
  /** Meeting notes model (specs/meeting-notes-model.md §4): set only by the
   *  "Create tasks" action item flow, never by the MCP tool's own input
   *  schema — backlinks Task.sourceRecordingId to the meeting it came from. */
  sourceRecordingId?: string;
};

export class CreateTaskError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CreateTaskError";
  }
}

export async function runCreateTask(callerId: string, input: Input) {
  if (!(await canEditProject(callerId, input.projectId))) {
    throw new CreateTaskError("Forbidden", 403);
  }

  const title = input.title.trim();
  if (!title) throw new CreateTaskError("Title is required", 400);

  const status = input.status ?? "Todo";
  if (!isTaskStatus(status) || status === "Backlog") {
    throw new CreateTaskError("Invalid status", 400);
  }

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, repoUrls: true },
  });
  if (!project) throw new CreateTaskError("Project not found", 404);

  let sprintId: string | null = null;
  if (input.sprintId === "current") {
    sprintId = await activeSprintId(input.projectId);
    if (!sprintId) throw new CreateTaskError("No sprint is running on this project", 400);
  } else if (input.sprintId) {
    sprintId = input.sprintId;
  } else if (input.forDay) {
    const t = Date.parse(input.forDay);
    if (!Number.isFinite(t)) throw new CreateTaskError("Invalid forDay", 400);
    sprintId = await openSprintForDay(input.projectId, utcDayOf(input.forDay));
  }
  const placed = await resolveTaskPlacement(input.projectId, {
    epicId: input.epicId || null,
    sprintId,
  });
  if ("error" in placed) throw new CreateTaskError(placed.error, 400);

  let githubRepo: string | null = null;
  if (input.mirrorToGithubRepo && input.mirrorToGithubRepo !== "") {
    const normalized = normalizeRepo(input.mirrorToGithubRepo);
    if (!normalized) throw new CreateTaskError("Invalid mirrorToGithubRepo", 400);
    const allowed = project.repoUrls
      .map(normalizeRepo)
      .filter((r): r is string => !!r);
    if (!allowed.includes(normalized)) {
      throw new CreateTaskError(
        "mirrorToGithubRepo is not one of the project's repoUrls",
        400,
      );
    }
    githubRepo = normalized;
  }

  const last = await prisma.task.findFirst({
    where: { projectId: input.projectId, status, sprintId: placed.sprintId ?? null },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const description = input.description?.trim() ?? "";

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        projectId: input.projectId,
        title,
        description: description === "" ? null : description,
        status,
        position,
        priority: input.priority ?? "Normal",
        epicId: placed.epicId,
        sprintId: placed.sprintId ?? null,
        domainId: input.domainId && input.domainId !== "" ? input.domainId : null,
        createdById: callerId,
        sourceRecordingId: input.sourceRecordingId ?? null,
      },
      select: { id: true },
    });
    if (input.assigneeUserIds && input.assigneeUserIds.length > 0) {
      await tx.taskAssignee.createMany({
        data: input.assigneeUserIds.map((userId) => ({
          taskId: created.id,
          userId,
        })),
        skipDuplicates: true,
      });
    }
    return created;
  });

  if (githubRepo) {
    void createIssueForTask(task.id, githubRepo).catch((err) =>
      console.error(`mcp create_task: github mirror failed for ${task.id}`, err),
    );
  }

  if (input.assigneeUserIds && input.assigneeUserIds.length > 0) {
    void notifyTaskAssigned({
      taskId: task.id,
      addedUserIds: input.assigneeUserIds,
      actorUserId: callerId,
    }).catch((err) =>
      console.error(`mcp create_task: assignment notify failed for ${task.id}`, err),
    );
  }

  return { id: task.id, status, position, epicId: placed.epicId, sprintId: placed.sprintId ?? null };
}
