import { termWeekNumber } from "~/lib/terms.shared";

export const MILESTONE_WEEKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const MILESTONE_KINDS = ["Milestone", "Plan"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export function isValidWeek(week: unknown): week is number {
  return typeof week === "number" && Number.isInteger(week) && week >= 0 && week <= 10;
}

export function weekStartMs(termStartMs: number, week: number): number {
  return termStartMs + (week - 1) * WEEK_MS;
}

export function weekRange(termStartMs: number, week: number): { startMs: number; endMs: number } {
  const startMs = weekStartMs(termStartMs, week);
  return { startMs, endMs: startMs + 6 * DAY_MS };
}

export function currentTermWeek(todayUtcMs: number, termStartMs: number): number | null {
  const week = termWeekNumber(todayUtcMs, termStartMs);
  if (week === 0 || (week >= 1 && week <= 10)) return week;
  return null;
}

export type SeasonTerm = { id: string; year: number; season: string };

export function sameSeasonLastYear<T extends SeasonTerm>(term: SeasonTerm, terms: T[]): T | null {
  return terms.find((t) => t.season === term.season && t.year === term.year - 1) ?? null;
}

export type PositionedItem = { id: string };

export function renumber<T extends PositionedItem>(items: T[]): { id: string; position: number }[] {
  return items.map((item, position) => ({ id: item.id, position }));
}

export function reorder<T extends PositionedItem>(items: T[], id: string, toIndex: number): T[] {
  const from = items.findIndex((i) => i.id === id);
  if (from === -1) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  const at = Math.max(0, Math.min(toIndex, next.length));
  next.splice(at, 0, moved);
  return next;
}

export function termLabel(term: { season: string; year: number }): string {
  const names: Record<string, string> = { W: "Winter", S: "Spring", X: "Summer", F: "Fall" };
  return `${names[term.season] ?? term.season} ${String(term.year % 100).padStart(2, "0")}`;
}

export function nextTermLabel(term: { season: string; year: number }): string {
  const order = ["W", "S", "X", "F"];
  const i = order.indexOf(term.season);
  if (i === order.length - 1) return termLabel({ season: "W", year: term.year + 1 });
  return termLabel({ season: order[i + 1], year: term.year });
}

export type MilestoneItem = {
  id: string;
  week: number;
  kind: MilestoneKind;
  title: string;
  notes: string | null;
  position: number;
  owners: { id: string; name: string }[];
};

export function itemsFor(items: MilestoneItem[], week: number, kind: MilestoneKind): MilestoneItem[] {
  return items.filter((i) => i.week === week && i.kind === kind);
}

export function weekSummary(items: MilestoneItem[], week: number, maxTitles = 2) {
  const milestones = itemsFor(items, week, "Milestone");
  return {
    titles: milestones.slice(0, maxTitles).map((m) => m.title),
    more: Math.max(0, milestones.length - maxTitles),
    planned: itemsFor(items, week, "Plan").length,
  };
}
