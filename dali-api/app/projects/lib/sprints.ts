// Pure sprint rules shared by the server (generation, rollover, backfill) and
// the client (board scope, timeline). All days are UTC-midnight ms.

import { DAY, SPRINT_DAYS, utcDayStart } from "./timeline-days";

const WEEK = SPRINT_DAYS * DAY;

/** A stored sprint as loaders hand it to the client. */
export type SprintModel = {
  id: string;
  number: number;
  termId: string;
  termCode: string;
  // UTC-midnight ISO instants; endsOn is the inclusive last day.
  startsOn: string;
  endsOn: string;
  closed: boolean;
  plannedCount: number | null;
  completedCount: number | null;
  carriedOverCount: number | null;
};

export function sprintDays(s: Pick<SprintModel, "startsOn" | "endsOn" | "closed">) {
  return { startsOn: Date.parse(s.startsOn), endsOn: Date.parse(s.endsOn), closed: s.closed };
}

/** "Sprint 4", or "26F · Sprint 4" when the list spans several terms. */
export function sprintLabel(s: Pick<SprintModel, "number" | "termCode">, multiTerm: boolean): string {
  return multiTerm ? `${s.termCode} · Sprint ${s.number}` : `Sprint ${s.number}`;
}

/** "Oct 7 – Oct 13" in UTC (sprint days are UTC-midnight dates). */
export function sprintRangeLabel(s: Pick<SprintModel, "startsOn" | "endsOn">): string {
  const f = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return `${f(s.startsOn)} – ${f(s.endsOn)}`;
}

export type SprintPlan = { number: number; startsOn: number; endsOn: number };

export type SprintStatus = "Upcoming" | "Active" | "Closed";

/** The UTC weekday (0 = Sunday) a team's sprints start on when none is set. */
export function defaultAnchorDay(termStartUtc: number): number {
  return new Date(utcDayStart(termStartUtc)).getUTCDay();
}

/**
 * A term's sprints: Sprint 1 starts on the first `anchorDay` on or after the
 * term start, each runs seven days, and the last is cut off at the term end.
 */
export function planSprints(
  term: { startsOn: number; endsOn: number },
  anchorDay: number | null,
): SprintPlan[] {
  const termStart = utcDayStart(term.startsOn);
  const termEnd = utcDayStart(term.endsOn);
  const anchor = anchorDay ?? defaultAnchorDay(termStart);
  const lead = (anchor - new Date(termStart).getUTCDay() + 7) % 7;
  const out: SprintPlan[] = [];
  for (let start = termStart + lead * DAY, n = 1; start <= termEnd; start += WEEK, n++) {
    out.push({ number: n, startsOn: start, endsOn: Math.min(start + WEEK - DAY, termEnd) });
  }
  return out;
}

export function sprintStatus(
  sprint: { startsOn: number; endsOn: number; closed: boolean },
  todayUtc: number,
): SprintStatus {
  if (sprint.closed || todayUtc > sprint.endsOn) return "Closed";
  return todayUtc >= sprint.startsOn ? "Active" : "Upcoming";
}

/**
 * The sprint the board opens on: the active one, else the next upcoming, else
 * the most recently ended. `sprints` may be in any order.
 */
export function defaultBoardSprint<T extends { startsOn: number; endsOn: number; closed: boolean }>(
  sprints: T[],
  todayUtc: number,
): T | null {
  const sorted = [...sprints].sort((a, z) => a.startsOn - z.startsOn);
  const active = sorted.find((s) => sprintStatus(s, todayUtc) === "Active");
  if (active) return active;
  const upcoming = sorted.find((s) => sprintStatus(s, todayUtc) === "Upcoming");
  if (upcoming) return upcoming;
  return sorted.at(-1) ?? null;
}

/**
 * Where a task in a removed (rebuilt) sprint lands: the candidate overlapping
 * the old window most, ties to the earlier one; with no overlap, the nearest
 * candidate starting after the old window, else the last candidate.
 */
export function remapByOverlap<T extends { startsOn: number; endsOn: number }>(
  old: { startsOn: number; endsOn: number },
  candidates: T[],
): T | null {
  const sorted = [...candidates].sort((a, z) => a.startsOn - z.startsOn);
  let best: T | null = null;
  let bestDays = 0;
  for (const c of sorted) {
    const days = (Math.min(old.endsOn, c.endsOn) - Math.max(old.startsOn, c.startsOn)) / DAY + 1;
    if (days > bestDays) {
      best = c;
      bestDays = days;
    }
  }
  if (best) return best;
  return sorted.find((c) => c.startsOn > old.endsOn) ?? sorted.at(-1) ?? null;
}

export type RolloverTask = { id: string; status: string };

/** Done and Cancelled stay; everything else carries, status unchanged. */
export function isCarriedOnClose(status: string): boolean {
  return status !== "Done" && status !== "Cancelled";
}

export type EpicDerivedStatus = "NotStarted" | "InProgress" | "Done" | "Cancelled";

export function deriveEpicStatus(
  epic: { cancelledAt: Date | string | null },
  taskStatuses: string[],
): EpicDerivedStatus {
  if (epic.cancelledAt) return "Cancelled";
  if (taskStatuses.length === 0) return "NotStarted";
  if (taskStatuses.every((s) => s === "Done" || s === "Cancelled")) return "Done";
  if (taskStatuses.some((s) => s !== "Todo" && s !== "Backlog")) return "InProgress";
  return "NotStarted";
}

/**
 * An epic's timeline span: first through last sprint holding one of its
 * tasks. Null when none of its tasks is in a sprint (the Unscheduled group).
 */
export function epicSprintSpan(
  taskSprints: ({ startsOn: number; endsOn: number } | null)[],
): { startsOn: number; endsOn: number } | null {
  const placed = taskSprints.filter((s): s is { startsOn: number; endsOn: number } => s !== null);
  if (placed.length === 0) return null;
  return {
    startsOn: Math.min(...placed.map((s) => s.startsOn)),
    endsOn: Math.max(...placed.map((s) => s.endsOn)),
  };
}

export type BackfillSprint = { id: string; termId: string; startsOn: number; endsOn: number };

/**
 * Where a pre-sprint task lands. `day` is the UTC day of `dueAt ?? startsAt`
 * (null = undated). `sprints` are the project's generated sprints (current and
 * future terms), `current` the sprint open tasks catch up into (active, else
 * next upcoming). Returns the sprint id, null for the backlog, and whether the
 * move counts as a carryover.
 */
export function backfillPlacement(
  task: { day: number | null; open: boolean },
  sprints: BackfillSprint[],
  termWindows: { id: string; startsOn: number; endsOn: number }[],
  current: BackfillSprint | null,
  todayUtc: number,
): { sprintId: string | null; carried: boolean } {
  if (task.day === null) return { sprintId: null, carried: false };
  const day = task.day;
  const sorted = [...sprints].sort((a, z) => a.startsOn - z.startsOn);
  let hit = sorted.find((s) => day >= s.startsOn && day <= s.endsOn) ?? null;
  if (!hit) {
    // Days before a term's first anchor day count toward that term's Sprint 1.
    const term = termWindows.find((t) => day >= t.startsOn && day <= t.endsOn);
    hit = term ? sorted.find((s) => s.termId === term.id && s.startsOn > day) ?? null : null;
  }
  if (!hit) {
    if (!task.open) return { sprintId: null, carried: false };
    return { sprintId: current?.id ?? null, carried: current !== null && day < todayUtc };
  }
  if (task.open && hit.endsOn < todayUtc) {
    return { sprintId: current?.id ?? null, carried: current !== null };
  }
  return { sprintId: hit.id, carried: false };
}

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
