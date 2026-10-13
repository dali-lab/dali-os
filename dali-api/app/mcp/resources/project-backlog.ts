// MCP resource `dali://projects/{projectId}/backlog` — the project's backlog:
// open tasks not yet in any sprint, in the team's ranked order.

import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";

export const PROJECT_BACKLOG_RESOURCE = {
  uriTemplate: "dali://projects/{projectId}/backlog",
  name: "Project backlog",
  description:
    "The project's backlog: open tasks not in any sprint, in the team's ranked order. Use this when planning a sprint; schedule a task with update_task's sprintId.",
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

export async function readProjectBacklogResource(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) throw new ProjectBacklogNotFoundError(projectId);

  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      archivedAt: null,
      sprintId: null,
      status: { notIn: ["Done", "Cancelled"] },
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      epicId: true,
      epic: { select: { title: true } },
      carryoverCount: true,
      assignees: {
        select: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  return JSON.stringify(
    {
      project: { id: project.id, name: project.name },
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        epicId: t.epicId,
        epicTitle: t.epic?.title ?? null,
        carriedOver: t.carryoverCount,
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
