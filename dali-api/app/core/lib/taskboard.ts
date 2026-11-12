import { taskMatchesQuery, type TaskCardModel } from "~/projects/lib/task-board";

export type CoreTaskFilters = {
  assigneeIds: string[];
  mine: boolean;
  currentUserId: string;
  query: string;
};

export function parseAssigneeParam(value: string): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

export function filterCoreTasks(tasks: TaskCardModel[], f: CoreTaskFilters): TaskCardModel[] {
  let out = tasks;
  if (f.mine) out = out.filter((t) => t.assignees.some((a) => a.id === f.currentUserId));
  if (f.assigneeIds.length > 0) {
    const want = new Set(f.assigneeIds);
    out = out.filter((t) => t.assignees.some((a) => want.has(a.id)));
  }
  if (f.query.trim()) out = out.filter((t) => taskMatchesQuery(t, f.query));
  return out;
}
