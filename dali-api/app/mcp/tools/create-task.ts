// MCP `create_task` — create a Task on a project. Mirrors
// api.projects.$id.tasks (Core or project member). Optionally mirrors to GitHub.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";
import { isTaskStatus, TASK_STATUSES } from "~/projects/lib/task-board";
import { createIssueForTask, normalizeRepo } from "~/projects/lib/github-task-sync";
import { notifyTaskAssigned } from "~/projects/lib/task-notifications.server";

const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

export const CREATE_TASK_TOOL = {
  name: "create_task",
  description:
    "Create a project task. Requires Core or project-member access. Lands at end of target column. Optionally mirrors to a GitHub issue (`mirrorToGithubRepo` must be one of the project's repoUrls).",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 500 },
      status: {
        type: "string",
        enum: TASK_STATUSES as unknown as string[],
        description: "Defaults to 'Todo'.",
      },
      priority: { type: "string", enum: PRIORITIES as unknown as string[] },
      sprintId: { type: "string", description: "Omit or empty string for backlog." },
      epicId: { type: "string", description: "Optional epic linkage." },
      domainId: { type: "string", description: "Optional domain chip." },
      dueAt: {
        type: "string",
        description: "ISO timestamp. Empty string or omitted = no deadline.",
      },
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
  status?: string;
  priority?: Priority;
  sprintId?: string;
  epicId?: string;
  domainId?: string;
  dueAt?: string;
  assigneeUserIds?: string[];
  mirrorToGithubRepo?: string;
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
  if (!isTaskStatus(status)) throw new CreateTaskError("Invalid status", 400);

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, repoUrls: true },
  });
  if (!project) throw new CreateTaskError("Project not found", 404);

  // A sprint/epic id must belong to this project — a foreign id would let a
  // member of one project file tasks onto another project's board (matches the
  // web create route's guard).
  if (input.sprintId && input.sprintId !== "") {
    const sprint = await prisma.sprint.findUnique({
      where: { id: input.sprintId },
      select: { projectId: true },
    });
    if (!sprint || sprint.projectId !== input.projectId) {
      throw new CreateTaskError("Sprint is not part of this project", 400);
    }
  }
  if (input.epicId && input.epicId !== "") {
    const epic = await prisma.epic.findUnique({
      where: { id: input.epicId },
      select: { projectId: true },
    });
    if (!epic || epic.projectId !== input.projectId) {
      throw new CreateTaskError("Epic is not part of this project", 400);
    }
  }

  let dueAt: Date | null = null;
  if (input.dueAt && input.dueAt !== "") {
    const d = new Date(input.dueAt);
    if (!Number.isFinite(d.getTime())) {
      throw new CreateTaskError("Invalid dueAt", 400);
    }
    dueAt = d;
  }

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
    where: { projectId: input.projectId, status },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        projectId: input.projectId,
        title,
        status,
        position,
        priority: input.priority ?? "Normal",
        sprintId: input.sprintId && input.sprintId !== "" ? input.sprintId : null,
        epicId: input.epicId && input.epicId !== "" ? input.epicId : null,
        domainId: input.domainId && input.domainId !== "" ? input.domainId : null,
        dueAt,
        createdById: callerId,
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

  return { id: task.id, status, position };
}
