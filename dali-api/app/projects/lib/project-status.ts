// Pure helper for the project Progress-tab status bar. Route loaders pass the
// project's raw task/sprint rows in; this turns them into the handful of
// work-status facts the bar renders (progress, active sprint, and the
// attention flags — overdue / unscheduled / in-review / stale). No Prisma
// import, so it lives beside the other client-safe board helpers and unit-tests
// without a DB. The AI-TLDR route runs the SAME function to build its prompt
// facts, so the summary and the chips can never disagree.

import type { TaskStatus } from "./task-board";

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
  let overdue = 0;
  let unscheduled = 0;
  let inReview = 0;
  let stale = 0;

  for (const t of tasks) {
    const closed = CLOSED.includes(t.status);
    if (t.status !== "Cancelled") totalTasks++;
    if (t.status === "Done") doneTasks++;
    if (t.status === "InReview") inReview++;
    if (!closed && t.dueAt != null && ms(t.dueAt) < nowMs) overdue++;
    if (t.sprintId == null && SCHEDULABLE.includes(t.status)) unscheduled++;
    if (t.status === "InProgress" && ms(t.activityAt) < staleBefore) stale++;
  }

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
    overdue,
    unscheduled,
    inReview,
    stale,
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
    f.overdue,
    f.unscheduled,
    f.inReview,
    f.stale,
    f.activeSprint?.id ?? null,
    f.activeSprint?.endsAt ?? null,
  ]);
}
