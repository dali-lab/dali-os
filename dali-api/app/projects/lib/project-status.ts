// Pure helper for the project Progress-tab status bar. Route loaders pass the
// project's raw task/sprint rows in; this turns them into the handful of
// work-status facts the bar renders (progress, active sprint, and the
// attention flags — overdue / unscheduled / in-review / stale). No Prisma
// import, so it lives beside the other client-safe board helpers and unit-tests
// without a DB. The AI-TLDR route runs the SAME function to build its prompt
// facts, so the summary and the chips can never disagree.

import type { TaskStatus, Priority } from "./task-board";

export type ProjectWorkStatus = "Active" | "Paused" | "Archived";
export type SprintPhase = "Planned" | "Active" | "Closed";

// An InProgress task untouched for this many days reads as stalled.
export const STALE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

// "Cancelled" work is dropped from the total (it isn't outstanding); "Done"
// counts toward completion. Everything else is open work.
const CLOSED: readonly TaskStatus[] = ["Done", "Cancelled"];
// Work that is in motion and therefore expected to sit in a sprint — a Backlog
// task with no sprint is intentional parking, not a planning gap, so it's
// excluded from the "unscheduled" flag.
const SCHEDULABLE: readonly TaskStatus[] = ["Todo", "InProgress", "InReview"];

export interface StatusTaskInput {
  id: string;
  status: TaskStatus;
  dueAt: Date | string | null;
  sprintId: string | null;
  activityAt: Date | string;
}

export interface StatusSprintInput {
  id: string;
  name: string;
  startsAt: Date | string;
  endsAt: Date | string;
  status: SprintPhase;
}

export interface ActiveSprintFacts {
  id: string;
  name: string;
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
  /** In-motion tasks (Todo/InProgress/InReview) with no sprint. */
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
  /** False for a project with no tasks and no sprints — the bar shows a calm
   *  "no work yet" state and callers skip the AI summary. */
  hasWork: boolean;
}

function ms(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * The active sprint the bar highlights: a sprint explicitly marked Active,
 * preferring the one ending soonest; failing that, an unclosed sprint whose
 * window contains `now`. Null when neither exists.
 */
function pickActiveSprint(
  sprints: StatusSprintInput[],
  nowMs: number,
): StatusSprintInput | null {
  const active = sprints
    .filter((s) => s.status === "Active")
    .sort((a, b) => ms(a.endsAt) - ms(b.endsAt));
  if (active.length) return active[0];

  const current = sprints
    .filter((s) => s.status !== "Closed" && ms(s.startsAt) <= nowMs && ms(s.endsAt) >= nowMs)
    .sort((a, b) => ms(a.endsAt) - ms(b.endsAt));
  return current[0] ?? null;
}

export function computeProjectStatus(
  input: {
    projectStatus: ProjectWorkStatus;
    tasks: StatusTaskInput[];
    sprints: StatusSprintInput[];
  },
  now: Date,
): ProjectStatusFacts {
  const nowMs = now.getTime();
  const staleBefore = nowMs - STALE_DAYS * DAY_MS;
  const { tasks, sprints } = input;

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
    if (t.sprintId == null && SCHEDULABLE.includes(t.status)) unscheduled++;
    if (t.status === "InProgress" && ms(t.activityAt) < staleBefore) staleIds.push(t.id);
  }
  overdueIds.sort();
  staleIds.sort();

  const picked = pickActiveSprint(sprints, nowMs);
  const activeSprint: ActiveSprintFacts | null = picked
    ? {
        id: picked.id,
        name: picked.name,
        endsAt: toIso(picked.endsAt),
        daysRemaining: Math.ceil((ms(picked.endsAt) - nowMs) / DAY_MS),
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
    hasWork: tasks.length > 0 || sprints.length > 0,
  };
}

/**
 * A stable fingerprint of the facts that should trigger an AI-summary refresh.
 * Deliberately excludes the active sprint's daysRemaining (only its id + end
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
    f.activeSprint?.id ?? null,
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
  /** High/Urgent tasks that are unscheduled (in motion, no sprint). */
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
      t.sprintId == null &&
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
