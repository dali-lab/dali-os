// MCP resource `dali://projects/{projectId}/board` — full board snapshot for
// a project: every sprint (active first), the tasks under each sprint grouped
// by status column, plus the project's backlog count. Lets a client cache one
// payload instead of looping through list_sprints/list_my_tasks. Read-only.

import { prisma } from "~/lib/db";
import { TASK_STATUSES, type TaskStatus } from "~/projects/lib/task-board";

export const PROJECT_BOARD_RESOURCE = {
  uriTemplate: "dali://projects/{projectId}/board",
  name: "Project board",
  description:
    "A project's full sprint board: every sprint with its tasks grouped by status (Todo, InProgress, InReview, Done, Cancelled). One round-trip; sized to one project.",
  mimeType: "application/json",
  requiredScope: "mcp:read" as const,
};

const URI_REGEX = /^dali:\/\/projects\/([^/]+)\/board$/;

export function matchProjectBoardUri(uri: string): { projectId: string } | null {
  const m = URI_REGEX.exec(uri);
  return m ? { projectId: m[1] } : null;
}

export class ProjectBoardNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} not found`);
    this.name = "ProjectBoardNotFoundError";
  }
}

export async function readProjectBoardResource(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, status: true },
  });
  if (!project) throw new ProjectBoardNotFoundError(projectId);

  const [sprints, tasks, backlogCount] = await Promise.all([
    prisma.sprint.findMany({
      where: { projectId },
      orderBy: [{ status: "asc" }, { startsAt: "desc" }],
      select: {
        id: true,
        name: true,
        status: true,
        startsAt: true,
        endsAt: true,
        epicId: true,
      },
    }),
    prisma.task.findMany({
      where: { projectId },
      orderBy: [{ status: "asc" }, { position: "asc" }],
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        sprintId: true,
        epicId: true,
        position: true,
        dueAt: true,
        assignees: {
          select: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    }),
    prisma.task.count({
      where: { projectId, sprintId: null, status: { notIn: ["Done", "Cancelled"] } },
    }),
  ]);

  type Card = {
    id: string;
    title: string;
    status: TaskStatus;
    priority: string;
    epicId: string | null;
    dueAt: string | null;
    assignees: { id: string; name: string }[];
  };

  function emptyBoard(): Record<TaskStatus, Card[]> {
    return Object.fromEntries(
      TASK_STATUSES.map((s) => [s, [] as Card[]]),
    ) as Record<TaskStatus, Card[]>;
  }

  const sprintBoards = new Map<string, Record<TaskStatus, Card[]>>();
  const backlog = emptyBoard();

  for (const t of tasks) {
    const card: Card = {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      epicId: t.epicId,
      dueAt: t.dueAt?.toISOString() ?? null,
      assignees: t.assignees.map((a) => ({
        id: a.user.id,
        name: `${a.user.firstName} ${a.user.lastName}`.trim(),
      })),
    };
    if (t.sprintId) {
      if (!sprintBoards.has(t.sprintId)) sprintBoards.set(t.sprintId, emptyBoard());
      sprintBoards.get(t.sprintId)![t.status].push(card);
    } else {
      backlog[t.status].push(card);
    }
  }

  return JSON.stringify(
    {
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
      },
      sprints: sprints.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        epicId: s.epicId,
        tasks: sprintBoards.get(s.id) ?? emptyBoard(),
      })),
      backlog: {
        openCount: backlogCount,
        tasks: backlog,
      },
    },
    null,
    2,
  );
}
