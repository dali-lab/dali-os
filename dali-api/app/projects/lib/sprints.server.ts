import { prisma } from "~/lib/db";
import type { Prisma } from "~/generated/prisma/client";
import { DAY, utcDayStart } from "./timeline-days";
import { labTodayUtcDay } from "~/lib/timezone";
import type { SprintAnchor } from "./task-board";
import {
  backfillPlacement,
  defaultAnchorDay,
  type SprintModel,
  defaultBoardSprint,
  isCarriedOnClose,
  planSprints,
  remapByOverlap,
  sprintStatus,
  type BackfillSprint,
} from "./sprints";

type Tx = Prisma.TransactionClient;

export const GENERAL_EPIC_TITLE = "General";

const ms = (d: Date) => utcDayStart(d.getTime());

/**
 * Materialize Sprint rows for every current and future term of a project, and
 * run the one-time task backfill the first time. Idempotent — safe on every
 * page load and job tick.
 */
export async function ensureSprints(projectId: string, now: Date = new Date()): Promise<void> {
  const today = labTodayUtcDay(now);
  const projectTerms = await prisma.projectTerm.findMany({
    where: { projectId, term: { endDate: { gte: new Date(today) } } },
    select: { termId: true, sprintAnchorDay: true, term: { select: { startDate: true, endDate: true } } },
  });
  for (const pt of projectTerms) {
    const exists = await prisma.sprint.count({ where: { projectId, termId: pt.termId } });
    if (exists > 0) continue;
    const plans = planSprints(
      { startsOn: ms(pt.term.startDate), endsOn: ms(pt.term.endDate) },
      pt.sprintAnchorDay,
    );
    await prisma.sprint.createMany({
      data: plans.map((p) => ({
        projectId,
        termId: pt.termId,
        number: p.number,
        startsOn: new Date(p.startsOn),
        endsOn: new Date(p.endsOn),
      })),
      skipDuplicates: true,
    });
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { sprintsBackfilledAt: true },
  });
  if (project && !project.sprintsBackfilledAt) await backfillProjectTasks(projectId, now);
}

export async function getOrCreateGeneralEpic(projectId: string, tx: Tx = prisma): Promise<string> {
  const existing = await tx.epic.findFirst({
    where: { projectId, title: GENERAL_EPIC_TITLE },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const last = await tx.epic.aggregate({ where: { projectId }, _max: { position: true } });
  const created = await tx.epic.create({
    data: { projectId, title: GENERAL_EPIC_TITLE, position: (last._max.position ?? -1) + 1 },
    select: { id: true },
  });
  return created.id;
}

/** The sprint open work catches up into: the active one, else the next upcoming. */
function catchUpSprint<T extends { startsOn: number; endsOn: number; closed: boolean }>(
  sprints: T[],
  today: number,
): T | null {
  const pick = defaultBoardSprint(sprints, today);
  return pick && sprintStatus(pick, today) !== "Closed" ? pick : null;
}

/**
 * Map a project's pre-sprint tasks onto stored sprints (dueAt ?? startsAt
 * decides the week), file epic-less tasks under General, flatten story
 * nesting, retire the Backlog status, then close sprints that already ended.
 */
export async function backfillProjectTasks(projectId: string, now: Date): Promise<void> {
  const today = labTodayUtcDay(now);
  await prisma.$transaction(
    async (tx) => {
      const claimed = await tx.project.updateMany({
        where: { id: projectId, sprintsBackfilledAt: null },
        data: { sprintsBackfilledAt: now },
      });
      if (claimed.count === 0) return;

      const [sprintRows, projectTerms, tasks] = await Promise.all([
        tx.sprint.findMany({
          where: { projectId },
          select: { id: true, termId: true, startsOn: true, endsOn: true, closedAt: true },
        }),
        tx.projectTerm.findMany({
          where: { projectId },
          select: { term: { select: { id: true, startDate: true, endDate: true } } },
        }),
        tx.task.findMany({
          where: { projectId, archivedAt: null, sprintId: null },
          select: {
            id: true,
            status: true,
            epicId: true,
            storyId: true,
            dueAt: true,
            startsAt: true,
            story: { select: { epicId: true } },
          },
        }),
      ]);
      const sprints: (BackfillSprint & { closed: boolean })[] = sprintRows.map((s) => ({
        id: s.id,
        termId: s.termId,
        startsOn: ms(s.startsOn),
        endsOn: ms(s.endsOn),
        closed: s.closedAt !== null,
      }));
      const terms = projectTerms.map((pt) => ({
        id: pt.term.id,
        startsOn: ms(pt.term.startDate),
        endsOn: ms(pt.term.endDate),
      }));
      const current = catchUpSprint(sprints, today);

      let generalId: string | null = null;
      for (const t of tasks) {
        const date = t.dueAt ?? t.startsAt;
        const open = t.status !== "Done" && t.status !== "Cancelled";
        const place = backfillPlacement(
          { day: date ? ms(date) : null, open },
          sprints,
          terms,
          current,
          today,
        );
        let epicId = t.epicId ?? t.story?.epicId ?? null;
        if (!epicId) epicId = generalId ??= await getOrCreateGeneralEpic(projectId, tx);
        await tx.task.update({
          where: { id: t.id },
          data: {
            sprintId: place.sprintId,
            carryoverCount: place.carried ? { increment: 1 } : undefined,
            epicId,
            status: t.status === "Backlog" ? "Todo" : undefined,
          },
        });
      }
    },
    { timeout: 60_000 },
  );
  await closeEndedSprints(projectId, now);
}

export type ClosedSprint = {
  id: string;
  number: number;
  termId: string;
  startsOn: Date;
  endsOn: Date;
  planned: number;
  completed: number;
  carried: number;
  nextSprintId: string | null;
};

/**
 * Close every sprint of the project whose last day has passed: snapshot its
 * tasks, roll unfinished ones into the next sprint of the same term (none from
 * a term's final sprint), and stamp the counts. The closedAt CAS makes a
 * double tick a no-op. Returns the sprints this call closed.
 */
export async function closeEndedSprints(projectId: string, now: Date): Promise<ClosedSprint[]> {
  const today = labTodayUtcDay(now);
  const ended = await prisma.sprint.findMany({
    where: { projectId, closedAt: null, endsOn: { lt: new Date(today) } },
    orderBy: { startsOn: "asc" },
    select: { id: true, number: true, termId: true, startsOn: true, endsOn: true },
  });
  const out: ClosedSprint[] = [];
  for (const sprint of ended) {
    const closed = await prisma.$transaction(async (tx) => {
      const claim = await tx.sprint.updateMany({
        where: { id: sprint.id, closedAt: null },
        data: { closedAt: now },
      });
      if (claim.count === 0) return null;
      const next = await tx.sprint.findFirst({
        where: { projectId, termId: sprint.termId, startsOn: { gt: sprint.startsOn } },
        orderBy: { startsOn: "asc" },
        select: { id: true },
      });
      const tasks = await tx.task.findMany({
        where: { sprintId: sprint.id, archivedAt: null },
        select: { id: true, status: true },
      });
      const carry = next ? tasks.filter((t) => isCarriedOnClose(t.status)) : [];
      const carryIds = new Set(carry.map((t) => t.id));
      await tx.sprintTaskSnapshot.createMany({
        data: tasks.map((t) => ({
          sprintId: sprint.id,
          taskId: t.id,
          statusAtClose: t.status,
          carriedToSprintId: carryIds.has(t.id) ? next!.id : null,
        })),
        skipDuplicates: true,
      });
      if (carry.length > 0) {
        await tx.task.updateMany({
          where: { id: { in: [...carryIds] } },
          data: { sprintId: next!.id, carryoverCount: { increment: 1 } },
        });
      }
      const completed = tasks.filter((t) => t.status === "Done").length;
      await tx.sprint.update({
        where: { id: sprint.id },
        data: {
          plannedCount: tasks.length,
          completedCount: completed,
          carriedOverCount: carry.length,
        },
      });
      return {
        ...sprint,
        planned: tasks.length,
        completed,
        carried: carry.length,
        nextSprintId: next?.id ?? null,
      };
    });
    if (closed) out.push(closed);
  }
  return out;
}

/**
 * Change a term's anchor weekday. Closed and active sprints stay; upcoming
 * sprints are rebuilt from the first new-anchor day after the active sprint,
 * and their tasks move to the rebuilt sprint overlapping their old week most.
 */
export async function setSprintAnchor(
  projectId: string,
  termId: string,
  anchorDay: number,
  now: Date = new Date(),
): Promise<void> {
  if (!Number.isInteger(anchorDay) || anchorDay < 0 || anchorDay > 6) {
    throw new Error("anchorDay must be 0–6");
  }
  const today = labTodayUtcDay(now);
  await prisma.$transaction(async (tx) => {
    const pt = await tx.projectTerm.update({
      where: { projectId_termId: { projectId, termId } },
      data: { sprintAnchorDay: anchorDay },
      select: { term: { select: { startDate: true, endDate: true } } },
    });
    const rows = await tx.sprint.findMany({
      where: { projectId, termId },
      orderBy: { startsOn: "asc" },
      select: { id: true, number: true, startsOn: true, endsOn: true, closedAt: true },
    });
    const sprints = rows.map((r) => ({
      ...r,
      s: { startsOn: ms(r.startsOn), endsOn: ms(r.endsOn), closed: r.closedAt !== null },
    }));
    const kept = sprints.filter((r) => sprintStatus(r.s, today) !== "Upcoming");
    const upcoming = sprints.filter((r) => sprintStatus(r.s, today) === "Upcoming");
    const lastKept = kept.at(-1);
    const termEnd = ms(pt.term.endDate);
    // A rebuild starts the day after the last kept sprint (or at the term start
    // if nothing has begun), so the grid never overlaps a running week.
    const rebuildFrom = lastKept ? lastKept.s.endsOn + DAY : ms(pt.term.startDate);
    if (rebuildFrom > termEnd) return;
    const plans = planSprints({ startsOn: rebuildFrom, endsOn: termEnd }, anchorDay);
    // A kept sprint that ends before the first new anchor day absorbs the gap
    // days, so no day of the term falls between sprints.
    if (lastKept && !lastKept.s.closed && plans[0] && plans[0].startsOn > rebuildFrom) {
      await tx.sprint.update({
        where: { id: lastKept.id },
        data: { endsOn: new Date(plans[0].startsOn - DAY) },
      });
    }
    const tasksByOld = await tx.task.findMany({
      where: { sprintId: { in: upcoming.map((u) => u.id) } },
      select: { id: true, sprintId: true },
    });
    await tx.sprint.deleteMany({ where: { id: { in: upcoming.map((u) => u.id) } } });
    const firstNumber = (lastKept?.number ?? 0) + 1;
    const candidates: { id: string; startsOn: number; endsOn: number }[] = [];
    for (const [i, p] of plans.entries()) {
      const row = await tx.sprint.create({
        data: {
          projectId,
          termId,
          number: firstNumber + i,
          startsOn: new Date(p.startsOn),
          endsOn: new Date(p.endsOn),
        },
        select: { id: true },
      });
      candidates.push({ id: row.id, startsOn: p.startsOn, endsOn: p.endsOn });
    }
    for (const old of upcoming) {
      const ids = tasksByOld.filter((t) => t.sprintId === old.id).map((t) => t.id);
      if (ids.length === 0) continue;
      const target = remapByOverlap(old.s, candidates);
      await tx.task.updateMany({ where: { id: { in: ids } }, data: { sprintId: target?.id ?? null } });
    }
  });
}

export type PlacementError = { error: string };

/**
 * Validate a task write's epic and sprint against the project. A missing epic
 * resolves to General; `sprintId` undefined means "not changing", null the
 * backlog. Closed sprints accept no new work.
 */
export async function resolveTaskPlacement(
  projectId: string,
  input: { epicId?: string | null; sprintId?: string | null },
  tx: Tx = prisma,
): Promise<{ epicId: string; sprintId: string | null | undefined } | PlacementError> {
  let epicId = input.epicId ?? null;
  if (epicId) {
    const epic = await tx.epic.findUnique({ where: { id: epicId }, select: { projectId: true } });
    if (!epic || epic.projectId !== projectId) return { error: "Epic is not part of this project" };
  } else {
    epicId = await getOrCreateGeneralEpic(projectId, tx);
  }
  const sprintId = input.sprintId;
  const sprintError = await checkSprintTarget(projectId, sprintId, tx);
  if (sprintError) return sprintError;
  return { epicId, sprintId };
}

/** Null when `sprintId` (undefined/null = no sprint) may take new work on this project. */
export async function checkSprintTarget(
  projectId: string,
  sprintId: string | null | undefined,
  tx: Tx = prisma,
): Promise<PlacementError | null> {
  if (!sprintId) return null;
  const sprint = await tx.sprint.findUnique({
    where: { id: sprintId },
    select: { projectId: true, closedAt: true },
  });
  if (!sprint || sprint.projectId !== projectId) return { error: "Sprint is not part of this project" };
  if (sprint.closedAt) return { error: "That sprint is closed" };
  return null;
}


export const SPRINT_MODEL_SELECT = {
  id: true,
  number: true,
  termId: true,
  startsOn: true,
  endsOn: true,
  closedAt: true,
  plannedCount: true,
  completedCount: true,
  carriedOverCount: true,
  term: { select: { code: true } },
} as const;

export function toSprintModel(s: {
  id: string;
  number: number;
  termId: string;
  startsOn: Date;
  endsOn: Date;
  closedAt: Date | null;
  plannedCount: number | null;
  completedCount: number | null;
  carriedOverCount: number | null;
  term: { code: string };
}): SprintModel {
  return {
    id: s.id,
    number: s.number,
    termId: s.termId,
    termCode: s.term.code,
    startsOn: s.startsOn.toISOString(),
    endsOn: s.endsOn.toISOString(),
    closed: s.closedAt !== null,
    plannedCount: s.plannedCount,
    completedCount: s.completedCount,
    carriedOverCount: s.carriedOverCount,
  };
}

export async function loadSprintModels(projectId: string): Promise<SprintModel[]> {
  const rows = await prisma.sprint.findMany({
    where: { projectId },
    orderBy: { startsOn: "asc" },
    select: SPRINT_MODEL_SELECT,
  });
  return rows.map(toSprintModel);
}

/** Effective anchor weekday for each current/future term of the project. */
export async function loadSprintAnchors(projectId: string, now: Date = new Date()): Promise<SprintAnchor[]> {
  const rows = await prisma.projectTerm.findMany({
    where: { projectId, term: { endDate: { gte: new Date(labTodayUtcDay(now)) } } },
    orderBy: { term: { sortKey: "asc" } },
    select: { termId: true, sprintAnchorDay: true, term: { select: { code: true, startDate: true } } },
  });
  return rows.map((r) => ({
    termId: r.termId,
    termCode: r.term.code,
    anchorDay: r.sprintAnchorDay ?? defaultAnchorDay(r.term.startDate.getTime()),
  }));
}

/**
 * The open sprint a day falls in; a day before every open sprint lands in the
 * earliest open one (work already due goes in now). Null past every sprint or
 * when the project has none — the backlog.
 */
export async function openSprintForDay(projectId: string, dayUtc: number): Promise<string | null> {
  const open = await prisma.sprint.findMany({
    where: { projectId, closedAt: null },
    orderBy: { startsOn: "asc" },
    select: { id: true, startsOn: true, endsOn: true },
  });
  const hit = open.find((s) => dayUtc >= ms(s.startsOn) && dayUtc <= ms(s.endsOn));
  if (hit) return hit.id;
  const first = open[0];
  return first && dayUtc < ms(first.startsOn) ? first.id : null;
}

/** The project's active sprint (today inside it, not yet closed), if any. */
export async function activeSprintId(projectId: string, now: Date = new Date()): Promise<string | null> {
  const today = new Date(labTodayUtcDay(now));
  const s = await prisma.sprint.findFirst({
    where: { projectId, closedAt: null, startsOn: { lte: today }, endsOn: { gte: today } },
    select: { id: true },
  });
  return s?.id ?? null;
}

/**
 * Delete an epic: its tasks move to the project's General epic, its user
 * stories go with it. General can't be deleted while it holds tasks.
 */
export async function deleteEpic(
  epicId: string,
  projectId: string,
): Promise<"ok" | "general-in-use"> {
  return prisma.$transaction(async (tx) => {
    const generalId = await getOrCreateGeneralEpic(projectId, tx);
    if (generalId === epicId && (await tx.task.count({ where: { epicId } })) > 0) {
      return "general-in-use";
    }
    await tx.task.updateMany({ where: { epicId }, data: { epicId: generalId } });
    await tx.userStory.deleteMany({ where: { epicId } });
    await tx.epic.delete({ where: { id: epicId } });
    return "ok";
  });
}
