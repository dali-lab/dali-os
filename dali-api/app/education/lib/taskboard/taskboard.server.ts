import { prisma } from "~/lib/db.server";
import { fullName } from "~/lib/display";
import { getActiveCoreCycleTermIds, getAdminUserIdsFromEnv, isCore } from "~/lib/roles";
import { moveTaskPatch, type TaskStatus } from "./rollover";
import type { MilestoneInput, PeriodInput, TaskInput } from "./validate";
import { termPeriodFromDates, type BoardPeriod, type PeriodKind } from "./weeks";

export type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({
  ok: false,
  status,
  error,
});

const SEASON_NAMES: Record<string, string> = { W: "Winter", S: "Spring", X: "Summer", F: "Fall" };
const DAY_MS = 86_400_000;

export async function seedPeriodsFromTerms(now: Date): Promise<void> {
  const terms = await prisma.term.findMany({
    where: {
      endDate: { gte: new Date(now.getTime() - 120 * DAY_MS) },
      startDate: { lte: new Date(now.getTime() + 400 * DAY_MS) },
      educationPeriod: null,
    },
    select: { id: true, code: true, year: true, season: true, startDate: true, endDate: true },
  });
  if (terms.length === 0) return;
  await prisma.educationPeriod.createMany({
    data: terms.map((t) => {
      const { startDate, weekCount } = termPeriodFromDates({ start: t.startDate, end: t.endDate });
      return {
        name: `${SEASON_NAMES[t.season] ?? t.season} ${t.year}`,
        shortName: t.code,
        kind: "Term" as const,
        startDate: new Date(`${startDate}T00:00:00Z`),
        weekCount,
        termId: t.id,
      };
    }),
    skipDuplicates: true,
  });
}

export async function coreMemberIds(): Promise<string[]> {
  const ids = new Set<string>(getAdminUserIdsFromEnv());
  const admins = await prisma.adminMembership.findMany({ select: { userId: true } });
  admins.forEach((a) => ids.add(a.userId));
  const cycleTermIds = await getActiveCoreCycleTermIds();
  if (cycleTermIds.length > 0) {
    const core = await prisma.coreAssignment.findMany({
      where: { termId: { in: cycleTermIds } },
      select: { userId: true },
    });
    core.forEach((c) => ids.add(c.userId));
  }
  return [...ids];
}

export type BoardMember = { id: string; name: string; photoUrl: string | null };

export async function listCoreMembers(): Promise<BoardMember[]> {
  const ids = await coreMemberIds();
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, photoUrl: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  return users.map((u) => ({ id: u.id, name: fullName(u), photoUrl: u.photoUrl }));
}

export type BoardMilestone = {
  id: string;
  periodId: string;
  name: string;
  description: string | null;
  startWeek: number;
  endWeek: number;
};

export type StoredTask = {
  id: string;
  title: string;
  description: string | null;
  periodId: string;
  milestoneId: string | null;
  week: number;
  weekday: number;
  status: TaskStatus;
  assigneeIds: string[];
  completedAt: string | null;
};

export const DEFAULT_TERM_WEEKS = 10;

export type BoardData = {
  termWeeks: number;
  periods: BoardPeriod[];
  milestones: BoardMilestone[];
  tasks: StoredTask[];
  members: BoardMember[];
};

export async function loadBoard(now: Date): Promise<BoardData> {
  await seedPeriodsFromTerms(now);
  const [termWeeks, periods, milestones, tasks, members] = await Promise.all([
    getTermWeeks(),
    prisma.educationPeriod.findMany({ orderBy: { startDate: "asc" } }),
    prisma.educationMilestone.findMany({ orderBy: [{ startWeek: "asc" }, { createdAt: "asc" }] }),
    prisma.educationTask.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    listCoreMembers(),
  ]);
  return {
    termWeeks,
    periods: periods.map((p) => ({
      id: p.id,
      name: p.name,
      shortName: p.shortName,
      kind: p.kind as PeriodKind,
      startDate: p.startDate.toISOString().slice(0, 10),
      weekCount: p.weekCount,
    })),
    milestones: milestones.map((m) => ({
      id: m.id,
      periodId: m.periodId,
      name: m.name,
      description: m.description,
      startWeek: m.startWeek,
      endWeek: m.endWeek,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      periodId: t.periodId,
      milestoneId: t.milestoneId,
      week: t.week,
      weekday: t.weekday,
      status: t.status as TaskStatus,
      assigneeIds: t.assigneeIds,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    })),
    members,
  };
}

export async function getTermWeeks(): Promise<number> {
  const row = await prisma.educationTaskboardSettings.findUnique({
    where: { id: "default" },
    select: { termWeeks: true },
  });
  return row?.termWeeks ?? DEFAULT_TERM_WEEKS;
}

export async function saveTermWeeks(termWeeks: number): Promise<Result> {
  await prisma.educationTaskboardSettings.upsert({
    where: { id: "default" },
    create: { id: "default", termWeeks },
    update: { termWeeks },
  });
  return { ok: true, value: undefined };
}

export async function periodWeekCounts(): Promise<Map<string, number>> {
  const rows = await prisma.educationPeriod.findMany({ select: { id: true, weekCount: true } });
  return new Map(rows.map((r) => [r.id, r.weekCount]));
}

async function checkRefs(input: { milestoneId: string | null; assigneeIds: string[] }): Promise<Result | null> {
  if (input.milestoneId) {
    const m = await prisma.educationMilestone.findUnique({ where: { id: input.milestoneId }, select: { id: true } });
    if (!m) return fail(400, "That milestone no longer exists.");
  }
  for (const id of input.assigneeIds) {
    if (!(await isCore(id))) return fail(400, "Tasks can only be assigned to Core members.");
  }
  return null;
}

export async function createTask(input: TaskInput, actorId: string): Promise<Result<{ id: string }>> {
  const bad = await checkRefs(input);
  if (bad) return bad as Result<{ id: string }>;
  const last = await prisma.educationTask.aggregate({ _max: { position: true } });
  const task = await prisma.educationTask.create({
    data: {
      title: input.title,
      description: input.description,
      periodId: input.periodId,
      milestoneId: input.milestoneId,
      week: input.week,
      weekday: input.weekday,
      status: input.status,
      assigneeIds: input.assigneeIds,
      createdById: actorId,
      position: (last._max.position ?? 0) + 1,
      completedAt: input.status === "Done" ? new Date() : null,
    },
    select: { id: true },
  });
  return { ok: true, value: task };
}

export async function updateTask(id: string, input: TaskInput): Promise<Result> {
  const existing = await prisma.educationTask.findUnique({ where: { id }, select: { status: true, completedAt: true } });
  if (!existing) return fail(404, "That task no longer exists.");
  const bad = await checkRefs(input);
  if (bad) return bad;
  const completedAt =
    input.status === "Done" ? (existing.status === "Done" ? existing.completedAt : new Date()) : null;
  await prisma.educationTask.update({
    where: { id },
    data: {
      title: input.title,
      description: input.description,
      periodId: input.periodId,
      milestoneId: input.milestoneId,
      week: input.week,
      weekday: input.weekday,
      status: input.status,
      assigneeIds: input.assigneeIds,
      completedAt,
    },
  });
  return { ok: true, value: undefined };
}

export async function deleteTask(id: string): Promise<Result> {
  const { count } = await prisma.educationTask.deleteMany({ where: { id } });
  return count === 0 ? fail(404, "That task no longer exists.") : { ok: true, value: undefined };
}

export async function moveTask(args: {
  id: string;
  status: TaskStatus;
  periodId: string;
  week: number;
  actorId: string;
  now: Date;
}): Promise<Result> {
  const task = await prisma.educationTask.findUnique({
    where: { id: args.id },
    select: { assigneeIds: true, status: true },
  });
  if (!task) return fail(404, "That task no longer exists.");
  const period = await prisma.educationPeriod.findUnique({
    where: { id: args.periodId },
    select: { weekCount: true },
  });
  if (!period || args.week < 1 || args.week > period.weekCount) return fail(400, "Pick a valid week.");
  const patch = moveTaskPatch(
    { assigneeIds: task.assigneeIds, status: task.status as TaskStatus },
    { status: args.status, periodId: args.periodId, week: args.week },
    args.actorId,
    args.now,
  );
  await prisma.educationTask.update({ where: { id: args.id }, data: patch });
  return { ok: true, value: undefined };
}

export async function createMilestone(input: MilestoneInput): Promise<Result<{ id: string }>> {
  const m = await prisma.educationMilestone.create({ data: input, select: { id: true } });
  return { ok: true, value: m };
}

export async function updateMilestone(id: string, input: MilestoneInput): Promise<Result> {
  const { count } = await prisma.educationMilestone.updateMany({ where: { id }, data: input });
  return count === 0 ? fail(404, "That milestone no longer exists.") : { ok: true, value: undefined };
}

export async function deleteMilestone(id: string): Promise<Result> {
  const { count } = await prisma.educationMilestone.deleteMany({ where: { id } });
  return count === 0 ? fail(404, "That milestone no longer exists.") : { ok: true, value: undefined };
}

export async function createPeriod(input: PeriodInput): Promise<Result<{ id: string }>> {
  const p = await prisma.educationPeriod.create({
    data: { ...input, startDate: new Date(`${input.startDate}T00:00:00Z`) },
    select: { id: true },
  });
  return { ok: true, value: p };
}

export async function updatePeriod(id: string, input: PeriodInput): Promise<Result> {
  const [lateTask, lateMilestone] = await Promise.all([
    prisma.educationTask.count({ where: { periodId: id, week: { gt: input.weekCount } } }),
    prisma.educationMilestone.count({ where: { periodId: id, endWeek: { gt: input.weekCount } } }),
  ]);
  if (lateTask > 0 || lateMilestone > 0) {
    return fail(409, "Move or remove tasks and milestones past the new last week first.");
  }
  const { count } = await prisma.educationPeriod.updateMany({
    where: { id },
    data: { ...input, startDate: new Date(`${input.startDate}T00:00:00Z`) },
  });
  return count === 0 ? fail(404, "That period no longer exists.") : { ok: true, value: undefined };
}

export async function deletePeriod(id: string): Promise<Result> {
  const tasks = await prisma.educationTask.count({ where: { periodId: id } });
  if (tasks > 0) return fail(409, "Move or remove this period's tasks first.");
  const { count } = await prisma.educationPeriod.deleteMany({ where: { id } });
  return count === 0 ? fail(404, "That period no longer exists.") : { ok: true, value: undefined };
}
