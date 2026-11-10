// MCP `list_my_tasks` — every project Task the authenticated member is
// assigned to, with epic/project context. By default hides Done and
// Cancelled. Filter by status or project. Requires the `mcp:read` scope.

import { prisma } from "~/lib/db.server";
import { TASK_STATUSES, type TaskStatus } from "~/projects/lib/task-board";
import { offsetPage, offsetWindow, pageProps, type PageArgs } from "../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 100 };

export const LIST_MY_TASKS_TOOL = {
  name: "list_my_tasks",
  description:
    "List project tasks the authenticated DALI OS member is assigned to. Defaults to open work (excludes Done and Cancelled). Filter by status or projectId. Pass page.nextCursor as cursor to read the next page until page.hasMore is false.",
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
      ...pageProps(PAGE_LIMITS),
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & {
  status?: TaskStatus[];
  projectId?: string;
};

const DEFAULT_OPEN_STATUSES: TaskStatus[] = ["Todo", "InProgress", "InReview"];

export async function runListMyTasks(callerId: string, input: Input) {
  const window = offsetWindow(input, PAGE_LIMITS);
  const statuses =
    input.status && input.status.length > 0 ? input.status : DEFAULT_OPEN_STATUSES;

  const fetched = await prisma.task.findMany({
    where: {
      assignees: { some: { userId: callerId } },
      status: { in: statuses },
      ...(input.projectId ? { projectId: input.projectId } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueAt: true,
      createdAt: true,
      projectId: true,
      project: { select: { name: true } },
      epicId: true,
      epic: { select: { title: true } },
      domain: { select: { displayName: true } },
      assignees: { select: { userId: true } },
    },
  });

  const { rows, page } = offsetPage(fetched, window);

  return {
    page,
    tasks: rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      projectId: t.projectId,
      projectName: t.project.name,
      epicId: t.epicId,
      epicTitle: t.epic?.title ?? null,
      domainName: t.domain?.displayName ?? null,
      assigneeUserIds: t.assignees.map((a) => a.userId),
    })),
  };
}
