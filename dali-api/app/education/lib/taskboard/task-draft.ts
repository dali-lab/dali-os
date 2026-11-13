import type { TaskStatus } from "./rollover";
import type { WeekRef } from "./weeks";

export function createStatus(
  draft: { assigneeIds: string[]; periodId: string; week: number },
  viewed: WeekRef | null,
): TaskStatus {
  const planned = viewed !== null && draft.periodId === viewed.periodId && draft.week === viewed.week;
  return draft.assigneeIds.length > 0 && planned ? "Todo" : "Backlog";
}
