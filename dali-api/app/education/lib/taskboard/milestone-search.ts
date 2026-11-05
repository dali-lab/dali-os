import type { BoardPeriod } from "./weeks";

export type MilestoneRef = {
  id: string;
  periodId: string;
  name: string;
  startWeek: number;
  endWeek: number;
};

export type MilestoneSearch = {
  mode: "in-period" | "across";
  items: MilestoneRef[];
};

export function searchMilestones(
  milestones: MilestoneRef[],
  periods: BoardPeriod[],
  duePeriodId: string,
  query: string,
): MilestoneSearch {
  const q = query.trim().toLowerCase();
  const order = new Map(periods.map((p, i) => [p.id, p.startDate + String(i).padStart(3, "0")]));
  const byWeek = (a: MilestoneRef, b: MilestoneRef) => a.startWeek - b.startWeek || a.name.localeCompare(b.name);
  if (q === "") {
    return { mode: "in-period", items: milestones.filter((m) => m.periodId === duePeriodId).sort(byWeek) };
  }
  const items = milestones
    .filter((m) => m.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aDue = a.periodId === duePeriodId ? 0 : 1;
      const bDue = b.periodId === duePeriodId ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      if (a.periodId !== b.periodId) return (order.get(a.periodId) ?? "").localeCompare(order.get(b.periodId) ?? "");
      return byWeek(a, b);
    });
  return { mode: "across", items };
}

export function milestoneLabel(milestone: MilestoneRef, periods: BoardPeriod[], duePeriodId: string): string {
  const short = periods.find((p) => p.id === milestone.periodId)?.shortName;
  const prefix = milestone.periodId !== duePeriodId && short ? ` · ${short}` : "";
  return `${milestone.name}${prefix} · Wk ${milestone.startWeek} to ${milestone.endWeek}`;
}

export function searchHeader(mode: MilestoneSearch["mode"], duePeriodShort: string): string {
  return mode === "across" ? "Matches across all terms" : `In ${duePeriodShort} · type to search other terms`;
}

export function createMilestoneLabel(query: string): string {
  const q = query.trim();
  return q === "" ? "+ Create a new milestone" : `+ Create milestone "${q}"`;
}

export function noMatchLabel(query: string): string {
  return `No milestone matches "${query.trim()}".`;
}
