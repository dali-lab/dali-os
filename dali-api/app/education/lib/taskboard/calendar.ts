import { WEEKDAYS, shortDate } from "./labels";
import type { StoredTask } from "./taskboard.server";
import { addDays, locateWeek, taskDate, type BoardPeriod, type WeekRef } from "./weeks";

export type DueRef = WeekRef & { weekday: number };

export type CalendarCell = { ymd: string; day: number } | null;
export type CalendarRow = { cells: CalendarCell[]; label: string };

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthTitle(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function weekLabel(periods: BoardPeriod[], ymd: string): string {
  const hit = locateWeek(periods, ymd);
  if (!hit) return "";
  const period = periods.find((p) => p.id === hit.periodId);
  return period?.kind === "Term" ? `Wk ${hit.week}` : `Int. ${hit.week}`;
}

export function monthRows(periods: BoardPeriod[], year: number, month: number): CalendarRow[] {
  const first = `${year}-${pad(month)}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay();
  const rows: CalendarRow[] = [];
  let day = 1 - lead;
  while (day <= daysInMonth) {
    const cells: CalendarCell[] = [];
    for (let i = 0; i < 7; i++, day++) {
      cells.push(day >= 1 && day <= daysInMonth ? { ymd: `${year}-${pad(month)}-${pad(day)}`, day } : null);
    }
    const firstInRange = cells.find((c) => c !== null);
    rows.push({ cells, label: firstInRange ? weekLabel(periods, firstInRange.ymd) : "" });
  }
  return rows;
}

export function dateToRef(periods: BoardPeriod[], ymd: string): DueRef | null {
  const hit = locateWeek(periods, ymd);
  if (!hit) return null;
  return { ...hit, weekday: new Date(`${ymd}T00:00:00Z`).getUTCDay() };
}

export function refToDate(periods: BoardPeriod[], ref: DueRef): string | null {
  const period = periods.find((p) => p.id === ref.periodId);
  return period ? taskDate(period, ref.week, ref.weekday) : null;
}

export function dueLabel(periods: BoardPeriod[], ref: DueRef): { main: string; day: string } {
  const period = periods.find((p) => p.id === ref.periodId);
  const ymd = refToDate(periods, ref);
  if (!period || !ymd) return { main: "Pick a date", day: "" };
  return {
    main: `${period.shortName} · Week ${ref.week}`,
    day: `${WEEKDAYS[ref.weekday]}, ${shortDate(ymd)}`,
  };
}

export function daysWithTasks(tasks: StoredTask[], periods: BoardPeriod[]): Set<string> {
  const byId = new Map(periods.map((p) => [p.id, p]));
  const days = new Set<string>();
  for (const t of tasks) {
    if (t.status === "Backlog") continue;
    const period = byId.get(t.periodId);
    if (period) days.add(taskDate(period, t.week, t.weekday));
  }
  return days;
}

export type LoadEntry = { userId: string; name: string; count: number; tone: "ok" | "busy" };

export const BUSY_AT = 3;

export function weekLoad(
  tasks: StoredTask[],
  members: { id: string; name: string }[],
  ref: WeekRef,
  excludeTaskId: string | null,
): LoadEntry[] {
  const names = new Map(members.map((m) => [m.id, m.name]));
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (t.id === excludeTaskId || t.status === "Done") continue;
    if (t.periodId !== ref.periodId || t.week !== ref.week) continue;
    for (const id of t.assigneeIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([userId, count]) => ({
      userId,
      name: names.get(userId) ?? "Someone",
      count,
      tone: count >= BUSY_AT ? ("busy" as const) : ("ok" as const),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function initialMonth(periods: BoardPeriod[], ref: DueRef | null, fallbackYmd: string): { year: number; month: number } {
  const ymd = (ref && refToDate(periods, ref)) || fallbackYmd;
  const [year, month] = ymd.split("-").map(Number);
  return { year, month };
}

export function weekStartOfRef(periods: BoardPeriod[], ref: WeekRef): string | null {
  const period = periods.find((p) => p.id === ref.periodId);
  return period ? addDays(period.startDate, (ref.week - 1) * 7) : null;
}
