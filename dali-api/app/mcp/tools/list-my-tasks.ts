// MCP `list_my_tasks` — every project Task the authenticated member is
// assigned to, with sprint/epic/project context. By default hides Done and
// Cancelled. Filter by status, project, or sprint. Requires the `mcp:read`
// scope.

import { prisma } from "~/lib/db";
import { TASK_STATUSES, type TaskStatus } from "~/projects/lib/task-board";

export const LIST_MY_TASKS_TOOL = {
  name: "list_my_tasks",
  description:
    "List project tasks the authenticated DALI OS member is assigned to. Defaults to open work (excludes Done and Cancelled). Filter by status, projectId, or sprintId.",
  inputSchema: {
    type: "object" as const,
    properties: {
      status: {
        type: "array",
        items: {
          type: "string",
          enum: TASK_STATUSES as unknown as string[],
        },
        maxItems: TASK_STATUSES.length,
        description:
          "Restrict to these task statuses. Default ['Todo','InProgress','InReview'] — pass explicit list to include Done/Cancelled.",
      },
      projectId: {
        type: "string",
        minLength: 1,
        description: "Restrict to a single project.",
      },
      sprintId: {
        type: "string",
        minLength: 1,
        description: "Restrict to a single sprint (use a sprintId from `get_project_overview`).",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Maximum tasks to return (default 50, max 100).",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = {
  status?: TaskStatus[];
  projectId?: string;
  sprintId?: string;
  limit?: number;
};

const DEFAULT_OPEN_STATUSES: TaskStatus[] = ["Todo", "InProgress", "InReview"];

export async function runListMyTasks(callerId: string, input: Input) {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const statuses =
    input.status && input.status.length > 0 ? input.status : DEFAULT_OPEN_STATUSES;

  const rows = await prisma.task.findMany({
    where: {
      assignees: { some: { userId: callerId } },
      status: { in: statuses },
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.sprintId ? { sprintId: input.sprintId } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueAt: true,
      createdAt: true,
      projectId: true,
      project: { select: { name: true } },
      sprintId: true,
      sprint: { select: { name: true } },
      epicId: true,
      epic: { select: { title: true } },
      domain: { select: { displayName: true } },
      assignees: { select: { userId: true } },
    },
  });

  return {
    tasks: rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      projectId: t.projectId,
      projectName: t.project.name,
      sprintId: t.sprintId,
      sprintName: t.sprint?.name ?? null,
      epicId: t.epicId,
      epicTitle: t.epic?.title ?? null,
      domainName: t.domain?.displayName ?? null,
      assigneeUserIds: t.assignees.map((a) => a.userId),
    })),
  };
}
