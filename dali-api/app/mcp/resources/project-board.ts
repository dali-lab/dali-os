// MCP resource `dali://projects/{projectId}/board` — full board snapshot for
// a project: every sprint (the term-anchored one-week bands, current first),
// the tasks under each sprint grouped by status column, plus the project's
// backlog (undated tasks). Sprints are computed from the project's terms — a
// task belongs to the sprint its date falls in. Lets a client cache one payload
// instead of looping through list_sprints/list_my_tasks. Read-only.

import { prisma } from "~/lib/db";
import { TASK_STATUSES, type TaskStatus } from "~/projects/lib/task-board";
import { DAY, SPRINT_DAYS, utcDayOf, localTodayUtcDay } from "~/projects/lib/timeline-days";
import { fullName } from "~/lib/display";

const SPRINT_STEP = SPRINT_DAYS * DAY;

export const PROJECT_BOARD_RESOURCE = {
  uriTemplate: "dali://projects/{projectId}/board",
  name: "Project board",
  description:
    "A project's full sprint board: every sprint (term-anchored week) with its tasks grouped by status (Todo, InProgress, InReview, Done, Cancelled), plus the undated backlog. One round-trip; sized to one project.",
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
    select: {
      id: true,
      name: true,
      status: true,
      projectTerms: {
        select: {
          term: { select: { code: true, startDate: true, endDate: true, sortKey: true } },
        },
      },
    },
  });
  if (!project) throw new ProjectBoardNotFoundError(projectId);

  const [tasks, backlogCount] = await Promise.all([
    prisma.task.findMany({
      where: { projectId },
      orderBy: [{ status: "asc" }, { position: "asc" }],
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        startsAt: true,
        dueAt: true,
        epicId: true,
        position: true,
        assignees: {
          select: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    }),
    prisma.task.count({
      where: {
        projectId,
        startsAt: null,
        dueAt: null,
        status: { notIn: ["Done", "Cancelled"] },
      },
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

  // The term-anchored sprint bands (Sprint 1..N per term), oldest term first.
  const today = localTodayUtcDay(new Date());
  const bands: {
    key: number;
    end: number;
    term: string;
    label: string;
    phase: "past" | "current" | "upcoming";
  }[] = [];
  for (const { term: t } of project.projectTerms.sort(
    (a, b) => a.term.sortKey - b.term.sortKey,
  )) {
    const start = utcDayOf(t.startDate.toISOString());
    const end = utcDayOf(t.endDate.toISOString());
    let n = 0;
    for (let key = start; key <= end; key += SPRINT_STEP, n++) {
      const bandEnd = Math.min(key + SPRINT_STEP - DAY, end);
      const phase =
        today >= key && today <= bandEnd ? "current" : today > bandEnd ? "past" : "upcoming";
      bands.push({ key, end: bandEnd, term: t.code, label: `Sprint ${n + 1}`, phase });
    }
  }

  const sprintBoards = new Map<number, Record<TaskStatus, Card[]>>();
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
        name: fullName(a.user),
      })),
    };
    // A task belongs to the sprint its anchor date (due, else start) falls in.
    const anchor = t.dueAt ?? t.startsAt;
    const day = anchor ? utcDayOf(anchor.toISOString()) : null;
    const band = day === null ? undefined : bands.find((b) => day >= b.key && day <= b.end);
    if (band) {
      if (!sprintBoards.has(band.key)) sprintBoards.set(band.key, emptyBoard());
      sprintBoards.get(band.key)![t.status].push(card);
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
      sprints: bands.map((b) => ({
        term: b.term,
        label: b.label,
        phase: b.phase,
        startsAt: new Date(b.key).toISOString(),
        endsAt: new Date(b.end + DAY).toISOString(),
        tasks: sprintBoards.get(b.key) ?? emptyBoard(),
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
