import {
  weekStart,
  type BoardPeriod,
  type WeekRef,
} from "./weeks";

export type TaskStatus = "Backlog" | "Todo" | "Doing" | "Done";

export type BoardTask = {
  id: string;
  periodId: string;
  week: number;
  status: TaskStatus;
  assigneeIds: string[];
};

export type PlacedTask<T extends BoardTask> = T & { rolledFrom: WeekRef | null };

const OPEN: TaskStatus[] = ["Todo", "Doing"];

export function placeTasksInWeek<T extends BoardTask>(args: {
  tasks: T[];
  periods: BoardPeriod[];
  viewed: WeekRef;
  current: WeekRef;
}): PlacedTask<T>[] {
  const { tasks, periods, viewed, current } = args;
  const byId = new Map(periods.map((p) => [p.id, p]));
  const viewedPeriod = byId.get(viewed.periodId);
  const currentPeriod = byId.get(current.periodId);
  if (!viewedPeriod || !currentPeriod) return [];
  const currentStart = weekStart(currentPeriod, current.week);
  const viewingCurrent =
    weekStart(viewedPeriod, viewed.week) === currentStart;

  const out: PlacedTask<T>[] = [];
  for (const task of tasks) {
    if (task.status === "Backlog") continue;
    const taskPeriod = byId.get(task.periodId);
    if (!taskPeriod) continue;
    const start = weekStart(taskPeriod, task.week);
    const overdue = OPEN.includes(task.status) && start < currentStart;
    if (overdue) {
      if (viewingCurrent) {
        out.push({
          ...task,
          rolledFrom: { periodId: task.periodId, week: task.week },
        });
      }
      continue;
    }
    if (task.periodId === viewed.periodId && task.week === viewed.week) {
      out.push({ ...task, rolledFrom: null });
    }
  }
  return out;
}

export function countRolledOver(placed: PlacedTask<BoardTask>[]): number {
  return placed.filter((t) => t.rolledFrom !== null).length;
}

export function rolledFromLabel(
  from: WeekRef,
  periods: BoardPeriod[],
  viewedPeriodId: string,
): string {
  if (from.periodId === viewedPeriodId) return `From wk ${from.week}`;
  const period = periods.find((p) => p.id === from.periodId);
  return `From ${period?.shortName ?? "earlier"} wk ${from.week}`;
}

export type MoveTarget = {
  status: TaskStatus;
  periodId: string;
  week: number;
};

export type MovePatch = {
  status: TaskStatus;
  periodId?: string;
  week?: number;
  assigneeIds?: string[];
  completedAt: Date | null;
};

export function moveTaskPatch(
  task: Pick<BoardTask, "assigneeIds" | "status">,
  target: MoveTarget,
  actorId: string,
  now: Date,
): MovePatch {
  const patch: MovePatch = {
    status: target.status,
    completedAt: target.status === "Done" ? now : null,
  };
  if (target.status === "Backlog") return patch;
  patch.periodId = target.periodId;
  patch.week = target.week;
  if (task.assigneeIds.length === 0) patch.assigneeIds = [actorId];
  return patch;
}
