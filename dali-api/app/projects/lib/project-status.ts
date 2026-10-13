// Pure helper for the project Progress-tab status bar: the project's task rows
// and sprints in, the work-status facts the bar renders out. The AI-TLDR route
// runs the same function, so the summary and the chips can't disagree.

import { TASK_STATUS_LABELS, type TaskStatus, type Priority } from "./task-board";
import { defaultBoardSprint, sprintStatus, type SprintModel } from "./sprints";
import { DAY, utcDayStart } from "./timeline-days";

export type ProjectWorkStatus = "Active" | "Paused" | "Archived";

// An InProgress task untouched for this many days reads as stalled.
export const STALE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

// "Cancelled" work is dropped from the total (it isn't outstanding); "Done"
// counts toward completion. Everything else is open work.
const CLOSED: readonly TaskStatus[] = ["Done", "Cancelled"];
// Started work belongs in a sprint; a To-do in the backlog is just planning.
const IN_MOTION: readonly TaskStatus[] = ["InProgress", "InReview"];

export interface StatusTaskInput {
  id: string;
  status: TaskStatus;
  // Null = the backlog.
  sprintId: string | null;
  carryoverCount: number;
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
  /** Open tasks that rolled over from an earlier sprint at least once. */
  carried: number;
  /** Started tasks (InProgress/InReview) sitting in the backlog. */
  unscheduled: number;
  inReview: number;
  /** InProgress tasks untouched for STALE_DAYS. */
  stale: number;
  /** Ids of the carried / stale tasks (sorted), for the AI fingerprint. */
  carriedIds: string[];
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
    sprints: SprintModel[];
  },
  now: Date,
  todayUtc: number = utcDayStart(now.getTime()),
): ProjectStatusFacts {
  const nowMs = now.getTime();
  const staleBefore = nowMs - STALE_DAYS * DAY_MS;
  const { tasks, sprints } = input;

  let totalTasks = 0;
  let doneTasks = 0;
  let unscheduled = 0;
  let inReview = 0;
  const carriedIds: string[] = [];
  const staleIds: string[] = [];

  for (const t of tasks) {
    const closed = CLOSED.includes(t.status);
    if (t.status !== "Cancelled") totalTasks++;
    if (t.status === "Done") doneTasks++;
    if (t.status === "InReview") inReview++;
    if (!closed && t.carryoverCount > 0) carriedIds.push(t.id);
    if (t.sprintId === null && IN_MOTION.includes(t.status)) unscheduled++;
    if (t.status === "InProgress" && ms(t.activityAt) < staleBefore) staleIds.push(t.id);
  }
  carriedIds.sort();
  staleIds.sort();

  const current = activeSprintOf(sprints, todayUtc);
  const activeSprint: ActiveSprintFacts | null = current
    ? {
        label: `Sprint ${current.number}`,
        startsAt: current.startsOn,
        // The boundary is the start of the day after the last sprint day.
        endsAt: new Date(Date.parse(current.endsOn) + DAY).toISOString(),
        daysRemaining: Math.ceil((Date.parse(current.endsOn) + DAY - nowMs) / DAY_MS),
      }
    : null;

  return {
    projectStatus: input.projectStatus,
    totalTasks,
    doneTasks,
    carried: carriedIds.length,
    unscheduled,
    inReview,
    stale: staleIds.length,
    carriedIds,
    staleIds,
    activeSprint,
    hasWork: tasks.length > 0,
  };
}

/** The sprint containing today, if one is running. */
export function activeSprintOf(sprints: SprintModel[], todayUtc: number): SprintModel | null {
  const pick = defaultBoardSprint(
    sprints.map((s) => ({ startsOn: Date.parse(s.startsOn), endsOn: Date.parse(s.endsOn), closed: s.closed, s })),
    todayUtc,
  );
  return pick && sprintStatus(pick, todayUtc) === "Active" ? pick.s : null;
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
    f.carriedIds,
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
  /** Most-carried first, capped. */
  carried: { title: string; priority: Priority; times: number }[];
  /** Longest-stalled first, capped. */
  stale: { title: string; daysStale: number }[];
  /** In-review task titles, capped. */
  inReview: string[];
  /** Open (non-closed) tasks at each urgent tier. */
  urgentOpen: number;
  highOpen: number;
  /** High/Urgent started tasks sitting in the backlog. */
  unscheduledHighPriority: number;
  /** Distinct assignees across all loaded tasks — a rough active-team size. */
  teamSize: number;
}

const CARRIED_CAP = 5;
const STALE_CAP = 3;
const IN_REVIEW_CAP = 4;

export function buildTldrDetail(tasks: TldrTaskInput[], now: Date): TldrDetail {
  const nowMs = now.getTime();
  const staleBefore = nowMs - STALE_DAYS * DAY_MS;

  const carried: TldrDetail["carried"] = [];
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
    if (!closed && t.carryoverCount > 0) {
      carried.push({ title: t.title, priority: t.priority, times: t.carryoverCount });
    }
    if (t.status === "InProgress" && ms(t.activityAt) < staleBefore) {
      stale.push({ title: t.title, daysStale: Math.floor((nowMs - ms(t.activityAt)) / DAY_MS) });
    }
    if (t.status === "InReview") inReview.push(t.title);
    if (
      t.sprintId === null &&
      IN_MOTION.includes(t.status) &&
      (t.priority === "High" || t.priority === "Urgent")
    ) {
      unscheduledHighPriority++;
    }
  }

  carried.sort((a, b) => b.times - a.times);
  stale.sort((a, b) => b.daysStale - a.daysStale);

  return {
    carried: carried.slice(0, CARRIED_CAP),
    stale: stale.slice(0, STALE_CAP),
    inReview: inReview.slice(0, IN_REVIEW_CAP),
    urgentOpen,
    highOpen,
    unscheduledHighPriority,
    teamSize: assignees.size,
  };
}

// ── Status-bar hover detail ───────────────────────────────────────────────────
// The chips show counts; each chip's hover tooltip needs the *named* tasks
// behind its count so a reader can see WHY — which tasks are overdue/stalled,
// what's left on the board. Pure + capped; the projects.$id loader is its only
// caller. Kept separate from computeProjectStatus so the AI fingerprint (which
// keys off the counts, not the titles) is unaffected by this presentational
// layer.

export interface BreakdownTaskInput extends StatusTaskInput {
  title: string;
  priority: Priority;
}

export interface StatusBreakdown {
  /** Non-empty task buckets in display order (Done → Backlog), the breakdown
   *  behind the done/total progress bar. Cancelled is omitted — it's excluded
   *  from the total too. */
  byStatus: { status: TaskStatus; label: string; count: number }[];
  /** Most-carried first. */
  carried: { title: string; priority: Priority; times: number }[];
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
const PROGRESS_ORDER: readonly TaskStatus[] = ["Done", "InReview", "InProgress", "Todo"];

const PRIORITY_RANK: Record<Priority, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

export function computeStatusBreakdown(tasks: BreakdownTaskInput[], now: Date): StatusBreakdown {
  const nowMs = now.getTime();
  const staleBefore = nowMs - STALE_DAYS * DAY_MS;

  const counts = new Map<TaskStatus, number>();
  const carried: StatusBreakdown["carried"] = [];
  const unscheduled: StatusBreakdown["unscheduled"] = [];
  const stale: StatusBreakdown["stale"] = [];
  const inReview: string[] = [];

  for (const t of tasks) {
    counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
    const closed = CLOSED.includes(t.status);
    if (!closed && t.carryoverCount > 0) {
      carried.push({ title: t.title, priority: t.priority, times: t.carryoverCount });
    }
    if (t.sprintId === null && IN_MOTION.includes(t.status)) {
      unscheduled.push({ title: t.title, priority: t.priority });
    }
    if (t.status === "InProgress" && ms(t.activityAt) < staleBefore) {
      stale.push({ title: t.title, daysStale: Math.floor((nowMs - ms(t.activityAt)) / DAY_MS) });
    }
    if (t.status === "InReview") inReview.push(t.title);
  }

  carried.sort((a, b) => b.times - a.times);
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
    carried: carried.slice(0, BREAKDOWN_CAP),
    unscheduled: unscheduled.slice(0, BREAKDOWN_CAP),
    stale: stale.slice(0, BREAKDOWN_CAP),
    inReview: inReview.slice(0, BREAKDOWN_CAP),
  };
}
