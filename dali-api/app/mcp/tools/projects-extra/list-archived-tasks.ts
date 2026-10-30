// MCP `list_archived_tasks` — list a project's archived tasks (Done /
// Cancelled tasks that fell off the board), newest-archived first.
// Mirrors the GET /api/projects/:id/tasks loader (archived filter).
//
// Gate: mcp:read (any authenticated member — mirrors the web loader's
// requireProjectEditAccess which is the same gate used for reading the board).

import { prisma } from "~/lib/db";
import { McpNotFoundError } from "./errors";
import { fullName } from "~/lib/display";
import { USER_NAME_SELECT } from "~/lib/prisma-shapes";
import { keysetPage, keysetWindow, pageProps, type PageArgs } from "../../pagination";

const PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const LIST_ARCHIVED_TASKS_TOOL = {
  name: "list_archived_tasks",
  description:
    "List archived (Done/Cancelled) tasks on a project, newest-archived first. These tasks no longer appear on the active board. Use `archive_done_tasks` to move live Done/Cancelled tasks to the archive. Pass page.nextCursor as cursor to read older archived tasks until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
      ...pageProps(PAGE_LIMITS),
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = PageArgs & { projectId: string };

export async function runListArchivedTasks(_callerId: string, input: Input) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) throw new McpNotFoundError("Project not found");

  const window = keysetWindow(input, PAGE_LIMITS, [
    { field: "archivedAt", direction: "desc", type: "date" },
  ]);
  const [fetched, total] = await Promise.all([
    prisma.task.findMany({
    where: { AND: [{ projectId: input.projectId, archivedAt: { not: null } }, window.where] },
    orderBy: window.orderBy,
    take: window.take,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueAt: true,
      archivedAt: true,
      domain: { select: { id: true, displayName: true } },
      assignees: { select: { user: { select: USER_NAME_SELECT } } },
    },
    }),
    prisma.task.count({ where: { projectId: input.projectId, archivedAt: { not: null } } }),
  ]);
  const { rows, page } = keysetPage(fetched, window, total);

  return {
    page,
    tasks: rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
      archivedAt: t.archivedAt!.toISOString(),
      domain: t.domain ? { id: t.domain.id, name: t.domain.displayName } : null,
      assignees: t.assignees.map((a) => ({ id: a.user.id, name: fullName(a.user) })),
    })),
  };
}
