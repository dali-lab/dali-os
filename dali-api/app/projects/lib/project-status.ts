// Pure helper for the project Progress-tab status bar. Route loaders pass the
// project's raw task rows + term spans in; this turns them into the handful of
// work-status facts the bar renders (progress, current sprint, and the
// attention flags — overdue / unscheduled / in-review / stale). No Prisma
// import, so it lives beside the other client-safe board helpers and unit-tests
// without a DB.

import { currentSprintBand, TASK_STATUS_LABELS, type TaskStatus, type Priority } from "./task-board";
import type { TimelineTermSpan } from "./timeline-days";

export type ProjectWorkStatus = "Active" | "Paused" | "Archived";

// An InProgress task untouched for this many days reads as stalled.
export const STALE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

// "Cancelled" work is dropped from the total (it isn't outstanding); "Done"
// counts toward completion. Everything else is open work.
const CLOSED: readonly TaskStatus[] = ["Done", "Cancelled"];
// Work that is in motion and therefore expected to be dated (so it lands in a
// sprint) — a Backlog task with no dates is intentional parking, not a planning
// gap, so it's excluded from the "unscheduled" flag.
const SCHEDULABLE: readonly TaskStatus[] = ["Todo", "InProgress", "InReview"];

export interface StatusTaskInput {
  id: string;
  status: TaskStatus;
  // A task's sprint is derived from its dates: undated (both null) = unplanned.
  startsAt: Date | string | null;
  dueAt: Date | string | null;
  activityAt: Date | string;
}

export interface ActiveSprintFacts {
  /** The sprint's positional label, e.g. "Sprint 3". */
  label: string;
  /** ISO string of the sprint's first day (UTC midnight). Drives the window the
   *  hover tooltip shows; not in the fingerprint (label + endsAt already move
   *  together with it). */
  startsAt: string;
  /** ISO string. The bar formats it; the fingerprint keys off it. */
  endsAt: string;
  /** Whole days until endsAt (ceil); negative once the sprint is overdue. */
  daysRemaining: number;
}

export interface ProjectStatusFacts {
  projectStatus: ProjectWorkStatus;
  /** Outstanding + done, excluding Cancelled. */
  totalTasks: number;
  doneTasks: number;
  /** Non-closed tasks whose dueAt is in the past. */
  overdue: number;
  /** In-motion tasks (Todo/InProgress/InReview) with no dates (unplanned). */
  unscheduled: number;
  inReview: number;
  /** InProgress tasks untouched for STALE_DAYS. */
  stale: number;
  /** Ids of the overdue / stale tasks (sorted). */
  overdueIds: string[];
  staleIds: string[];
  activeSprint: ActiveSprintFacts | null;
  /** False for a project with no tasks — the bar shows a calm "no work yet"
   *  state. */
  hasWork: boolean;
}

function ms(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function computeProjectStatus(
  input: {
    projectStatus: ProjectWorkStatus;
    tasks: StatusTaskInput[];
    terms: TimelineTermSpan[];
  },
  now: Date,
): ProjectStatusFacts {
  const nowMs = now.getTime();
  const staleBefore = nowMs - STALE_DAYS * DAY_MS;
  const { tasks, terms } = input;

  let totalTasks = 0;
  let doneTasks = 0;
  let unscheduled = 0;
  let inReview = 0;
  const overdueIds: string[] = [];
  const staleIds: string[] = [];

  for (const t of tasks) {
    const closed = CLOSED.includes(t.status);
    if (t.status !== "Cancelled") totalTasks++;
    if (t.status === "Done") doneTasks++;
    if (t.status === "InReview") inReview++;
    if (!closed && t.dueAt != null && ms(t.dueAt) < nowMs) overdueIds.push(t.id);
    if (t.startsAt == null && t.dueAt == null && SCHEDULABLE.includes(t.status)) unscheduled++;
    if (t.status === "InProgress" && ms(t.activityAt) < staleBefore) staleIds.push(t.id);
  }
  overdueIds.sort();
  staleIds.sort();

  // The current sprint = the term-anchored 7-day band containing today. band.end
  // is the last day's UTC midnight, so the sprint boundary is the start of the
  // day after it.
  const band = currentSprintBand(terms, now);
  const activeSprint: ActiveSprintFacts | null = band
    ? {
        label: band.label,
        startsAt: new Date(band.key).toISOString(),
        endsAt: new Date(band.end + DAY_MS).toISOString(),
        daysRemaining: Math.ceil((band.end + DAY_MS - nowMs) / DAY_MS),
      }
    : null;

  return {
    projectStatus: input.projectStatus,
    totalTasks,
    doneTasks,
    overdue: overdueIds.length,
    unscheduled,
    inReview,
    stale: staleIds.length,
    overdueIds,
    staleIds,
    activeSprint,
    hasWork: tasks.length > 0,
  };
}

// ── Status-bar hover detail ───────────────────────────────────────────────────
// The chips show counts; each chip's hover tooltip needs the *named* tasks
// behind its count so a reader can see WHY — which tasks are overdue/stalled,
// what's left on the board. Pure + capped; the projects.$id loader is its only
// caller. Kept separate from computeProjectStatus as a presentational layer.

export interface BreakdownTaskInput extends StatusTaskInput {
  title: string;
  priority: Priority;
}

export interface StatusBreakdown {
  /** Non-empty task buckets in display order (Done → Backlog), the breakdown
   *  behind the done/total progress bar. Cancelled is omitted — it's excluded
   *  from the total too. */
  byStatus: { status: TaskStatus; label: string; count: number }[];
  /** Most-overdue first. */
  overdue: { title: string; priority: Priority; daysOver: number }[];
  /** Highest-priority first, then title. */
  unscheduled: { title: string; priority: Priority }[];
  /** Longest-stalled first. */
  stale: { title: string; daysStale: number }[];
  inReview: string[];
}

// How many named tasks a tooltip lists before collapsing the rest to "+N more".
export const BREAKDOWN_CAP = 6;

// Progress-bar tooltip order: what's finished first, then work in flight, then
// what hasn't started.
const PROGRESS_ORDER: readonly TaskStatus[] = ["Done", "InReview", "InProgress", "Todo", "Backlog"];

const PRIORITY_RANK: Record<Priority, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

export function computeStatusBreakdown(tasks: BreakdownTaskInput[], now: Date): StatusBreakdown {
  const nowMs = now.getTime();
  const staleBefore = nowMs - STALE_DAYS * DAY_MS;

  const counts = new Map<TaskStatus, number>();
  const overdue: StatusBreakdown["overdue"] = [];
  const unscheduled: StatusBreakdown["unscheduled"] = [];
  const stale: StatusBreakdown["stale"] = [];
  const inReview: string[] = [];

  for (const t of tasks) {
    counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
    const closed = CLOSED.includes(t.status);
    if (!closed && t.dueAt != null && ms(t.dueAt) < nowMs) {
      overdue.push({
        title: t.title,
        priority: t.priority,
        daysOver: Math.floor((nowMs - ms(t.dueAt)) / DAY_MS),
      });
    }
    if (t.startsAt == null && t.dueAt == null && SCHEDULABLE.includes(t.status)) {
      unscheduled.push({ title: t.title, priority: t.priority });
    }
    if (t.status === "InProgress" && ms(t.activityAt) < staleBefore) {
      stale.push({ title: t.title, daysStale: Math.floor((nowMs - ms(t.activityAt)) / DAY_MS) });
    }
    if (t.status === "InReview") inReview.push(t.title);
  }

  overdue.sort((a, b) => b.daysOver - a.daysOver);
  unscheduled.sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title),
  );
  stale.sort((a, b) => b.daysStale - a.daysStale);

  const byStatus = PROGRESS_ORDER.map((status) => ({
    status,
    label: TASK_STATUS_LABELS[status],
    count: counts.get(status) ?? 0,
  })).filter((s) => s.count > 0);

  return {
    byStatus,
    overdue: overdue.slice(0, BREAKDOWN_CAP),
    unscheduled: unscheduled.slice(0, BREAKDOWN_CAP),
    stale: stale.slice(0, BREAKDOWN_CAP),
    inReview: inReview.slice(0, BREAKDOWN_CAP),
  };
}
