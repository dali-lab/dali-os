import type { WeekRelation } from "./weeks";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function dateRange(startYmd: string, endYmd: string): string {
  return `${shortDate(startYmd)} to ${shortDate(endYmd)}`;
}

export function weeksLabel(n: number): string {
  return n === 1 ? "1 week" : `${n} weeks`;
}

export function relationLabel(relation: WeekRelation, weeksAway: number): string {
  if (relation === "current") return "This week";
  if (relation === "past") return "Past";
  if (relation === "next") return "Next week";
  return `In ${weeksLabel(weeksAway)}`;
}

export function rolloverBanner(count: number, fromWeek: number | null): string | null {
  if (count === 0) return null;
  const noun = count === 1 ? "task" : "tasks";
  const source = fromWeek === null ? "earlier weeks" : `Week ${fromWeek}`;
  return `${count} ${noun} rolled over from ${source}. Anything not done by Saturday moves to next week.`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export function taskMeta(args: {
  assignees: string[];
  week: number;
  weekday: number;
  periodShort: string | null;
}): string {
  const who = args.assignees.length > 0 ? args.assignees.map(firstName).join(", ") : "Unassigned";
  const prefix = args.periodShort ? `${args.periodShort} ` : "";
  return `${who} · ${prefix}Wk ${args.week} ${WEEKDAYS[args.weekday]}`;
}
