// Pure helper for the project Progress-tab status bar. Route loaders pass the
// project's raw task rows + term spans in; this turns them into the handful of
// work-status facts the bar renders (progress, current sprint, and the
// attention flags — overdue / unscheduled / in-review / stale). No Prisma
// import, so it lives beside the other client-safe board helpers and unit-tests
// without a DB. The AI-TLDR route runs the SAME function to build its prompt
// facts, so the summary and the chips can never disagree.

import { currentSprintBand, type TaskStatus, type Priority } from "./task-board";
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
  /** Ids of the overdue / stale tasks (sorted). Not rendered — they ride in the
   *  fingerprint so the cached AI summary regenerates when the *specific*
   *  problem tasks change, not just when the totals do. */
  overdueIds: string[];
  staleIds: string[];
  activeSprint: ActiveSprintFacts | null;
  /** False for a project with no tasks — the bar shows a calm "no work yet"
   *  state and callers skip the AI summary. */
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

/**
 * A stable fingerprint of the facts that should trigger an AI-summary refresh.
 * Deliberately excludes the active sprint's daysRemaining (only its label + end
 * date) so the countdown ticking over doesn't force a daily regeneration — the
 * 24h TTL handles time drift, and the live countdown lives on the chip anyway.
 */
export function factsFingerprint(f: ProjectStatusFacts): string {
  return JSON.stringify([
    f.projectStatus,
    f.totalTasks,
    f.doneTasks,
    f.unscheduled,
    f.inReview,
    // Identity, not just counts: the AI summary names specific overdue/stalled
    // tasks, so it must regenerate when *which* tasks those are changes.
    f.overdueIds,
    f.staleIds,
    f.activeSprint?.label ?? null,
    f.activeSprint?.endsAt ?? null,
  ]);
}

// ── AI summary detail ─────────────────────────────────────────────────────────
// The deterministic facts above drive the chips; the AI line needs richer,
// specific material to say something the chips don't. This builds that material
// (named tasks, priority mix, team size) for the prompt. Pure + testable; the
// TLDR route is its only caller.

export interface TldrTaskInput extends StatusTaskInput {
  title: string;
  priority: Priority;
  assigneeIds: string[];
}

export interface TldrDetail {
  /** Most-overdue first, capped. */
  overdue: { title: string; priority: Priority; daysOver: number }[];
  /** Longest-stalled first, capped. */
  stale: { title: string; daysStale: number }[];
  /** In-review task titles, capped. */
  inReview: string[];
  /** Open (non-closed) tasks at each urgent tier. */
  urgentOpen: number;
  highOpen: number;
  /** High/Urgent tasks that are unscheduled (in motion, no dates). */
  unscheduledHighPriority: number;
  /** Distinct assignees across all loaded tasks — a rough active-team size. */
  teamSize: number;
}

const OVERDUE_CAP = 5;
const STALE_CAP = 3;
const IN_REVIEW_CAP = 4;

export function buildTldrDetail(tasks: TldrTaskInput[], now: Date): TldrDetail {
  const nowMs = now.getTime();
  const staleBefore = nowMs - STALE_DAYS * DAY_MS;

  const overdue: TldrDetail["overdue"] = [];
  const stale: TldrDetail["stale"] = [];
  const inReview: string[] = [];
  const assignees = new Set<string>();
  let urgentOpen = 0;
  let highOpen = 0;
  let unscheduledHighPriority = 0;

  for (const t of tasks) {
    const closed = CLOSED.includes(t.status);
    for (const a of t.assigneeIds) assignees.add(a);
    if (!closed) {
      if (t.priority === "Urgent") urgentOpen++;
      else if (t.priority === "High") highOpen++;
    }
    if (!closed && t.dueAt != null && ms(t.dueAt) < nowMs) {
      overdue.push({
        title: t.title,
        priority: t.priority,
        daysOver: Math.floor((nowMs - ms(t.dueAt)) / DAY_MS),
      });
    }
    if (t.status === "InProgress" && ms(t.activityAt) < staleBefore) {
      stale.push({ title: t.title, daysStale: Math.floor((nowMs - ms(t.activityAt)) / DAY_MS) });
    }
    if (t.status === "InReview") inReview.push(t.title);
    if (
      t.startsAt == null &&
      t.dueAt == null &&
      SCHEDULABLE.includes(t.status) &&
      (t.priority === "High" || t.priority === "Urgent")
    ) {
      unscheduledHighPriority++;
    }
  }

  overdue.sort((a, b) => b.daysOver - a.daysOver);
  stale.sort((a, b) => b.daysStale - a.daysStale);

  return {
    overdue: overdue.slice(0, OVERDUE_CAP),
    stale: stale.slice(0, STALE_CAP),
    inReview: inReview.slice(0, IN_REVIEW_CAP),
    urgentOpen,
    highOpen,
    unscheduledHighPriority,
    teamSize: assignees.size,
  };
}
