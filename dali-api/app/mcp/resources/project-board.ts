// MCP resource `dali://projects/{projectId}/board` — a project's whole sprint
// board in one payload: every stored sprint with its tasks grouped by status,
// plus the backlog count. Read-only.

import { prisma } from "~/lib/db";
import { BOARD_STATUSES, type TaskStatus } from "~/projects/lib/task-board";
import { fullName } from "~/lib/display";
import { ensureSprints, loadSprintModels } from "~/projects/lib/sprints.server";
import { sprintDays, sprintStatus } from "~/projects/lib/sprints";
import { labTodayUtcDay } from "~/lib/timezone";

export const PROJECT_BOARD_RESOURCE = {
  uriTemplate: "dali://projects/{projectId}/board",
  name: "Project board",
  description:
    "A project's full sprint board: every weekly sprint (with phase and, once closed, its planned/completed/carried-over snapshot) and the live tasks in it grouped by status (Todo, InProgress, InReview, Done, Cancelled), plus the backlog's open count. One round-trip; sized to one project.",
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

type Card = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: string;
  epicId: string | null;
  carriedOver: number;
  assignees: { id: string; name: string }[];
};

export async function readProjectBoardResource(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, status: true },
  });
  if (!project) throw new ProjectBoardNotFoundError(projectId);
  await ensureSprints(projectId);

  const [sprints, tasks, backlogCount] = await Promise.all([
    loadSprintModels(projectId),
    prisma.task.findMany({
      where: { projectId, archivedAt: null, sprintId: { not: null } },
      orderBy: [{ status: "asc" }, { position: "asc" }],
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        epicId: true,
        sprintId: true,
        carryoverCount: true,
        assignees: {
          select: { user: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    }),
    prisma.task.count({
      where: { projectId, archivedAt: null, sprintId: null, status: { notIn: ["Done", "Cancelled"] } },
    }),
  ]);

  const emptyBoard = () =>
    Object.fromEntries(BOARD_STATUSES.map((s) => [s, [] as Card[]])) as Record<TaskStatus, Card[]>;
  const boards = new Map(sprints.map((s) => [s.id, emptyBoard()]));
  for (const t of tasks) {
    const board = boards.get(t.sprintId!);
    if (!board) continue;
    (board[t.status] ??= []).push({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      epicId: t.epicId,
      carriedOver: t.carryoverCount,
      assignees: t.assignees.map((a) => ({ id: a.user.id, name: fullName(a.user) })),
    });
  }

  const today = labTodayUtcDay(new Date());
  return JSON.stringify(
    {
      project,
      sprints: sprints.map((s) => ({
        id: s.id,
        term: s.termCode,
        label: `Sprint ${s.number}`,
        phase: sprintStatus(sprintDays(s), today).toLowerCase(),
        startsOn: s.startsOn,
        endsOn: s.endsOn,
        ...(s.closed
          ? { planned: s.plannedCount, completed: s.completedCount, carriedOver: s.carriedOverCount }
          : {}),
        tasks: boards.get(s.id),
      })),
      backlog: { openCount: backlogCount },
    },
    null,
    2,
  );
}
