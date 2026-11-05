import type { TaskStatus } from "./rollover";

export type BacklogScope = "term" | "year";

export type BacklogTask = {
  id: string;
  milestoneId: string | null;
  periodId: string;
  week: number;
  status: TaskStatus;
};

export type BacklogMilestone = {
  id: string;
  periodId: string;
  name: string;
  startWeek: number;
  endWeek: number;
};

export type BacklogGroup<T> = {
  key: string;
  milestone: BacklogMilestone | null;
  name: string;
  done: number;
  total: number;
  rows: T[];
};

export const LOOSE_GROUP_KEY = "loose";
export const LOOSE_GROUP_NAME = "Loose tasks";

export function buildBacklogGroups<T extends BacklogTask>(args: {
  tasks: T[];
  milestones: BacklogMilestone[];
  scope: BacklogScope;
  periodId: string;
  show: (task: T) => boolean;
}): BacklogGroup<T>[] {
  const { tasks, milestones, scope, periodId, show } = args;
  const byWeek = (a: T, b: T) => a.week - b.week;
  const ordered = [...milestones].sort(
    (a, b) => a.startWeek - b.startWeek || a.name.localeCompare(b.name),
  );

  const groups: BacklogGroup<T>[] = [];
  for (const m of ordered) {
    if (scope === "term" && m.periodId !== periodId) continue;
    const own = tasks.filter((t) => t.milestoneId === m.id);
    if (own.length === 0) continue;
    groups.push({
      key: m.id,
      milestone: m,
      name: m.name,
      done: own.filter((t) => t.status === "Done").length,
      total: own.length,
      rows: own.filter((t) => t.status === "Backlog" && show(t)).sort(byWeek),
    });
  }

  const known = new Set(milestones.map((m) => m.id));
  const loose = tasks
    .filter((t) => t.status === "Backlog" && (t.milestoneId === null || !known.has(t.milestoneId)))
    .filter((t) => scope === "year" || t.periodId === periodId)
    .filter(show)
    .sort(byWeek);
  groups.push({
    key: LOOSE_GROUP_KEY,
    milestone: null,
    name: LOOSE_GROUP_NAME,
    done: 0,
    total: loose.length,
    rows: loose,
  });
  return groups;
}

export function backlogCount<T>(groups: BacklogGroup<T>[]): number {
  return groups.reduce((n, g) => n + g.rows.length, 0);
}

export function groupMeta<T>(group: BacklogGroup<T>): string {
  if (!group.milestone) return `${group.rows.length} waiting`;
  return `Wk ${group.milestone.startWeek} to ${group.milestone.endWeek} · ${group.done}/${group.total}`;
}

export function isGroupRelevant<T extends BacklogTask>(
  group: BacklogGroup<T>,
  viewed: { periodId: string; week: number },
): boolean {
  if (group.milestone) {
    const m = group.milestone;
    return m.periodId === viewed.periodId && viewed.week >= m.startWeek && viewed.week <= m.endWeek;
  }
  return group.rows.some((t) => t.periodId === viewed.periodId && t.week === viewed.week);
}
