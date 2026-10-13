// Pure drag planning for the backlog view: which tasks change and what to POST
// to /api/tasks/:id/move.

import { isTaskFinished, type TaskCardModel } from "./task-board";

export const BACKLOG_COLUMN = "backlog";

type MoveBody =
  | { status: string; orderedIds: string[]; sprintId?: string | null }
  | { status: string; position: number; sprintId: string };

/** The backlog in rank order: open tasks in no sprint. */
export function rankedBacklog(tasks: TaskCardModel[]): TaskCardModel[] {
  return tasks
    .filter((t) => t.sprintId === null && !isTaskFinished(t))
    .sort((a, z) => a.position - z.position || a.createdAt.localeCompare(z.createdAt));
}

/**
 * Plan dropping `taskId` on `overId` — a column id (the backlog or a sprint id)
 * or another card's id. Null when the drop changes nothing.
 */
export function planBacklogMove(
  tasks: TaskCardModel[],
  taskId: string,
  overId: string,
): { tasks: TaskCardModel[]; body: MoveBody } | null {
  const moved = tasks.find((t) => t.id === taskId);
  if (!moved || overId === taskId) return null;
  const overTask = tasks.find((t) => t.id === overId);
  const from = moved.sprintId ?? BACKLOG_COLUMN;
  const target = overTask ? (overTask.sprintId ?? BACKLOG_COLUMN) : overId;

  if (target === BACKLOG_COLUMN) {
    const order = rankedBacklog(tasks).filter((t) => t.id !== taskId);
    const at = overTask ? order.findIndex((t) => t.id === overTask.id) : -1;
    order.splice(at < 0 ? order.length : at, 0, moved);
    const orderedIds = order.map((t) => t.id);
    const before = rankedBacklog(tasks).map((t) => t.id);
    if (from === BACKLOG_COLUMN && orderedIds.join() === before.join()) return null;
    const rank = new Map(orderedIds.map((id, i) => [id, i]));
    return {
      tasks: tasks.map((t) =>
        rank.has(t.id)
          ? { ...t, position: rank.get(t.id)!, ...(t.id === taskId ? { sprintId: null } : {}) }
          : t,
      ),
      body:
        from === BACKLOG_COLUMN
          ? { status: moved.status, orderedIds }
          : { status: moved.status, orderedIds, sprintId: null },
    };
  }

  if (target === from) return null;
  const column = tasks.filter((t) => t.sprintId === target && t.status === moved.status);
  const position = column.length ? Math.max(...column.map((t) => t.position)) + 1 : 0;
  return {
    tasks: tasks.map((t) => (t.id === taskId ? { ...t, sprintId: target, position } : t)),
    body: { status: moved.status, position, sprintId: target },
  };
}
