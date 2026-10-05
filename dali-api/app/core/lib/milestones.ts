// Core milestones: the vocabulary shared by the board (/core/milestones) and
// the hub banner. Client-safe.

/** Academic-year order, which is the order the tabs read in. */
export const MILESTONE_SEASONS = ["F", "W", "S", "X"] as const;
export type MilestoneSeason = (typeof MILESTONE_SEASONS)[number];

/** Week 0 is the lead-up before the term starts; 1-10 are the term itself. */
export const LAST_MILESTONE_WEEK = 10;
export const MILESTONE_WEEKS = Array.from({ length: LAST_MILESTONE_WEEK + 1 }, (_, i) => i);

/** Filter value standing for milestones with no domain. */
export const ALL_LAB = "all-lab";

export function weekLabel(week: number): string {
  return week === 0 ? "Before term" : `Week ${week}`;
}

const WEEK_MS = 7 * 86_400_000;

/** Which board column `now` falls in for a term starting on `startDate`. */
export function termWeek(startDate: Date, now: Date): number {
  const elapsed = now.getTime() - startDate.getTime();
  if (elapsed < 0) return 0;
  return Math.min(LAST_MILESTONE_WEEK, Math.floor(elapsed / WEEK_MS) + 1);
}

/**
 * A column's ids after `id` is dropped on `overId` (null for the column itself,
 * which appends). Within a column, dragging down lands after the card under
 * the pointer and dragging up lands before it, which is how the cards have
 * already shuffled on screen by the time the drop happens.
 */
export function dropOrder(column: string[], id: string, overId: string | null): string[] {
  const rest = column.filter((x) => x !== id);
  const overIndex = overId === null ? -1 : column.indexOf(overId);
  if (overIndex === -1) return [...rest, id];
  rest.splice(column.includes(id) ? overIndex : rest.indexOf(overId!), 0, id);
  return rest;
}

/** An empty filter shows everything; otherwise a milestone shows when it
 *  carries any picked domain, or is lab-wide and ALL_LAB is picked. */
export function matchesDomainFilter(domainIds: string[], filter: string[]): boolean {
  if (filter.length === 0) return true;
  if (domainIds.length === 0) return filter.includes(ALL_LAB);
  return domainIds.some((id) => filter.includes(id));
}
