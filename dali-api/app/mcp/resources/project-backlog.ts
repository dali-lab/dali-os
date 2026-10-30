// MCP resource `dali://projects/{projectId}/backlog` — every undated task on a
// project (no start or due date, so it isn't in any sprint yet). The project
// board resource includes a count but not the cards themselves; backlog is
// exposed separately because it can be large and a client may only need it when
// planning the next sprint.

import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";

export const PROJECT_BACKLOG_RESOURCE = {
  uriTemplate: "dali://projects/{projectId}/backlog",
  name: "Project backlog",
  description:
    "Every undated task on a project (no start or due date, so unscheduled into any sprint), excluding Done/Cancelled. Returns at most 200 tasks, highest priority first, with total and truncated; when truncated, list_my_tasks with projectId reads the caller's own tasks on the project. Use this when planning the next sprint.",
  mimeType: "application/json",
  requiredScope: "mcp:read" as const,
};

const URI_REGEX = /^dali:\/\/projects\/([^/]+)\/backlog$/;

export function matchProjectBacklogUri(uri: string): { projectId: string } | null {
  const m = URI_REGEX.exec(uri);
  return m ? { projectId: m[1] } : null;
}

export class ProjectBacklogNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} not found`);
    this.name = "ProjectBacklogNotFoundError";
  }
}

const BACKLOG_LIMIT = 200;

export async function readProjectBacklogResource(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) throw new ProjectBacklogNotFoundError(projectId);

  const where = {
    projectId,
    startsAt: null,
    dueAt: null,
    status: { notIn: ["Done", "Cancelled"] as ("Done" | "Cancelled")[] },
  };
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
    where,
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    take: BACKLOG_LIMIT,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      epicId: true,
      epic: { select: { title: true } },
      dueAt: true,
      assignees: {
        select: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
    }),
    prisma.task.count({ where }),
  ]);

  return JSON.stringify(
    {
      project: { id: project.id, name: project.name },
      total,
      truncated: total > tasks.length,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        epicId: t.epicId,
        epicTitle: t.epic?.title ?? null,
        dueAt: t.dueAt?.toISOString() ?? null,
        assignees: t.assignees.map((a) => ({
          id: a.user.id,
          name: fullName(a.user),
        })),
      })),
    },
    null,
    2,
  );
}
