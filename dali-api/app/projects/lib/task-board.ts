// Pure helpers for the project task board. Mirrors the shape conventions in
// staffing-board.ts: route loaders pass plain data in, the component renders
// the board the helper builds, and persistence goes through an /api route.

import {
  DAY,
  SPRINT_DAYS,
  utcDayOf,
  localTodayUtcDay,
  type SprintBand,
  type TimelineTermSpan,
} from "./timeline-days";

export const TASK_STATUSES = [
  "Backlog",
  "Todo",
  "InProgress",
  "InReview",
  "Done",
  "Cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  Backlog: "Backlog",
  Todo: "To do",
  InProgress: "In progress",
  InReview: "In review",
  Done: "Done",
  Cancelled: "Cancelled",
};

export type Priority = "Low" | "Normal" | "High" | "Urgent";

export type TaskCardModel = {
  id: string;
  title: string;
  // Plain-text task description, edited in the task modal. Null when unset.
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  position: number;
  // ISO timestamp (UTC) or null. The pill on TaskCard formats it for display.
  // Stored as a string here so the model serializes cleanly through the
  // loader → client boundary without a Date round-trip.
  dueAt: string | null;
  // Optional timeline start, paired with dueAt to give the task a span on the
  // project timeline. Planning-only — it fires no reminders.
  startsAt: string | null;
  epicId: string | null;
  // Optional parent user story. Drives the timeline's task-inside-story
  // nesting; null hangs the task directly off its epic/sprint.
  storyId: string | null;
  // Subtasks checklist (Task.checklist Json). Null when unset; the card shows
  // a done/total chip and the modal owns editing.
  checklist: { text: string; done: boolean }[] | null;
  // Each assignee with id + display name. Id powers the modal's assignee
  // dropdown; name powers the card chip.
  assignees: { id: string; name: string }[];
  // Optional domain label on the task itself (Domain.code/displayName).
  // Independent of who's assigned.
  domain: { id: string; name: string } | null;
  // GitHub mirror link, populated when the task was created with the
  // "Create GitHub issue" toggle on. Both fields are present together; both
  // null means the task is not mirrored.
  githubIssueUrl: string | null;
  githubIssueNumber: number | null;
  // Linked work artifacts (ProjectFile) — versioned uploads the task's work
  // lives in (graphics, animation, design exports). Card shows a count chip;
  // the modal lists them with links to the file page.
  files: { id: string; title: string; versionCount: number }[];
  // Number of comments on the task — the card's comment chip. The modal owns
  // the thread itself; this is just the count the board shows.
  commentCount: number;
  createdBy: { id: string; name: string };
  // ISO timestamp (UTC).
  createdAt: string;
  // Last meaningful activity on the task (status/field edit, description
  // change, assignee change, comment, attached file, GitHub link — see
  // Task.activityAt), as an ISO timestamp. Dates the card's "Updated" chip.
  activityAt: string;
  // True when `activityAt` is newer than the viewer's last open. False for
  // tasks the viewer has never opened, so a fresh board isn't flagged "new"
  // wall-to-wall. Drives the card's "Updated" chip.
  hasUnread: boolean;
};

// The board's sprint scope (the sprint filter, stored in `?sprint=`): which
// sprint's work the board is showing. `all` is every task, `current` the sprint
// containing today, `backlog` the undated pool, or a concrete sprint key (the
// band's UTC-midnight start, stringified). Sprints are the term-anchored 7-day
// bands the timeline draws — not stored rows. The extra `(string & {})` keeps
// the three literals in autocomplete while still admitting any band key.
export type SprintScope = "all" | "current" | "backlog" | (string & {});

const SPRINT_STEP = SPRINT_DAYS * DAY;

/** The UTC-day window [start, end] of the term containing `day`, or null. */
function termWindowContaining(
  terms: TimelineTermSpan[],
  day: number,
): { start: number; end: number } | null {
  for (const t of terms) {
    const start = utcDayOf(t.startsAt);
    const end = utcDayOf(t.endsAt);
    if (day >= start && day <= end) return { start, end };
  }
  return null;
}

/**
 * The sprint band containing `now`: the term-anchored 7-day band, numbered from
 * 1 off its term's start (a ten-week term gives Sprint 1..10). Null when today
 * falls outside every term (a break week) — the board then has no "current"
 * sprint rather than surfacing an out-of-term band.
 */
export function currentSprintBand(
  terms: TimelineTermSpan[],
  now: Date,
): SprintBand | null {
  const today = localTodayUtcDay(now);
  const term = termWindowContaining(terms, today);
  if (!term) return null;
  const n = Math.floor((today - term.start) / SPRINT_STEP);
  const key = term.start + n * SPRINT_STEP;
  const end = Math.min(key + SPRINT_STEP - DAY, term.end);
  return { key, end, label: `Sprint ${n + 1}` };
}

/** The [start, end] UTC days a task's dates cover, or null when undated. */
function taskSpanDays(task: {
  startsAt: string | null;
  dueAt: string | null;
}): { start: number; end: number } | null {
  const startIso = task.startsAt ?? task.dueAt;
  const endIso = task.dueAt ?? task.startsAt;
  if (!startIso || !endIso) return null;
  return { start: utcDayOf(startIso), end: utcDayOf(endIso) };
}

/**
 * The scope the board opens on when the URL names none: the current sprint if
 * one is running (mirroring the term filter's "open on this term" default),
 * else every task.
 */
export function defaultSprintScope(
  terms: TimelineTermSpan[],
  now: Date,
): SprintScope {
  return currentSprintBand(terms, now) ? "current" : "all";
}

/**
 * Resolve the effective scope from a raw `?sprint=` value: an explicit,
 * still-valid value wins; anything stale (`current` with nothing running, or a
 * band key that isn't a term-aligned sprint start) falls back to the default.
 */
export function resolveSprintScope(
  param: string | null,
  terms: TimelineTermSpan[],
  now: Date,
): SprintScope {
  const fallback = defaultSprintScope(terms, now);
  if (!param || param === "all" || param === "backlog") return param || fallback;
  if (param === "current") {
    return currentSprintBand(terms, now) ? "current" : fallback;
  }
  const key = Number(param);
  if (!Number.isFinite(key)) return fallback;
  const term = termWindowContaining(terms, key);
  return term && (key - term.start) % SPRINT_STEP === 0 ? param : fallback;
}

/**
 * Does a task fall in the selected scope? `all` matches everything; `current`
 * the sprint containing today; `backlog` the undated; a concrete band key any
 * task whose date span overlaps that 7-day band — the same rule the timeline
 * uses to place task bars, so board and timeline agree.
 */
export function taskInSprintScope(
  task: { startsAt: string | null; dueAt: string | null },
  scope: SprintScope,
  terms: TimelineTermSpan[],
  now: Date,
): boolean {
  if (scope === "all") return true;
  const span = taskSpanDays(task);
  if (scope === "backlog") return span === null;
  if (span === null) return false;
  const key =
    scope === "current" ? currentSprintBand(terms, now)?.key ?? null : Number(scope);
  if (key === null || !Number.isFinite(key)) return false;
  return span.start <= key + SPRINT_STEP - DAY && span.end >= key;
}

/**
 * The sprint-filter picker options for the selected term's sprints
 * (`Sprint 1..N · Current|Past|Upcoming`), current-first, then upcoming
 * ascending, then past newest-first. Empty when no specific term is selected —
 * the picker is disabled while the board shows all terms, since sprint numbers
 * reset per term and a flat list would be ambiguous.
 */
export function sprintPickerOptions(
  terms: TimelineTermSpan[],
  selectedTermCode: string | null,
  now: Date,
): { value: string; label: string }[] {
  if (!selectedTermCode) return [];
  const term = terms.find((t) => t.code === selectedTermCode);
  if (!term) return [];
  const start = utcDayOf(term.startsAt);
  const end = utcDayOf(term.endsAt);
  const today = localTodayUtcDay(now);
  const bands: { key: number; label: string; phase: string; rank: number }[] = [];
  let n = 0;
  for (let key = start; key <= end; key += SPRINT_STEP, n++) {
    const bandEnd = Math.min(key + SPRINT_STEP - DAY, end);
    const phase =
      today >= key && today <= bandEnd ? "Current" : today > bandEnd ? "Past" : "Upcoming";
    const rank = phase === "Current" ? 0 : phase === "Upcoming" ? 1 : 2;
    bands.push({ key, label: `Sprint ${n + 1}`, phase, rank });
  }
  bands.sort((a, z) =>
    a.rank !== z.rank ? a.rank - z.rank : a.rank === 2 ? z.key - a.key : a.key - z.key,
  );
  return bands.map((b) => ({ value: String(b.key), label: `${b.label} · ${b.phase}` }));
}

export type BoardEpic = {
  id: string;
  title: string;
  // Terms this epic has work in — union of its sprints' resolved terms, terms
  // overlapping its effective date span, and its explicit target term. The
  // board's term filter prunes epic pills whose termIds miss the selected term.
  termIds: string[];
};

// Choices the TaskModal needs to populate its assignee + domain dropdowns.
// Loader fetches once per board render and passes through to TaskBoard.
export type TaskBoardOptions = {
  members: { id: string; name: string; photoUrl: string | null }[];
  domains: { id: string; name: string }[];
  // Project.repoUrls — surfaced in the TaskModal's "Create GitHub issue"
  // picker. Empty array hides the picker entirely.
  repoUrls: string[];
  // Term spans, oldest first — the same anchor the timeline's fixed one-week
  // sprint grid uses. The modal derives which weeks a task lands in from its
  // dates against this rather than asking anyone to pick a sprint.
  termSpans: TimelineTermSpan[];
  epics: BoardEpic[];
  // The project's user stories, for the modal's story picker. Ordered by epic
  // then position; `epicId` drives the same Epic → child cascade as sprints.
  stories: { id: string; title: string; epicId: string }[];
  // Live project files for the modal's "attach existing artifact" picker.
  projectFiles: { id: string; title: string }[];
  // Term filter options: the project's planned terms plus any term a sprint
  // resolves to, newest first. Fewer than two terms hides the filter.
  terms: { id: string; code: string }[];
  // The lab's current term when it appears in `terms` — the board's default
  // filter selection. Null (project doesn't run this term) defaults to All.
  currentTermId: string | null;
};

// Minimal Term shape the resolvers need. Callers pass terms sorted
// chronologically (ascending sortKey/startDate).
export type TermWindow = { id: string; startDate: Date; endDate: Date };

/**
 * Resolve the term a date falls in: the term whose [startDate, endDate]
 * window contains it, or — for dates in an inter-term gap (break weeks) —
 * the next upcoming term, mirroring currentTerm()'s roll-forward so a sprint
 * planned during the break before a term counts toward that term. Null when
 * the date is after every term's end.
 */
export function resolveTermIdForDate(
  terms: TermWindow[],
  date: Date,
): string | null {
  for (const t of terms) {
    if (date <= t.endDate) return t.id;
  }
  return null;
}

/**
 * Terms whose windows overlap [start, end]. Either bound may be null
 * (open-ended): a null start matches every term up to `end`, a null end every
 * term from `start` on. Both null = no dated span = no terms.
 */
export function termIdsInRange(
  terms: TermWindow[],
  start: Date | null,
  end: Date | null,
): string[] {
  if (!start && !end) return [];
  return terms
    .filter(
      (t) => (!start || t.endDate >= start) && (!end || t.startDate <= end),
    )
    .map((t) => t.id);
}

/**
 * Does a task match a board search? Every whitespace-separated token has to
 * land somewhere in the task, so "sophie login" narrows rather than widens.
 * Searches what the card shows (title, assignees, domain) plus the description
 * the modal holds — a task you remember by its body is still findable.
 */
export function taskMatchesQuery(task: TaskCardModel, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = [
    task.title,
    task.description ?? "",
    task.domain?.name ?? "",
    ...task.assignees.map((a) => a.name),
  ]
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export type TaskBoard = Record<TaskStatus, TaskCardModel[]>;

/**
 * Group tasks into columns keyed by status, each column ordered by `position`
 * then creation order (stable: input order is the tiebreaker since callers
 * pass tasks already ordered by createdAt).
 */
export function buildTaskBoard(tasks: TaskCardModel[]): TaskBoard {
  const board = Object.fromEntries(
    TASK_STATUSES.map((s) => [s, [] as TaskCardModel[]]),
  ) as TaskBoard;

  for (const task of tasks) {
    // Defensive: an unknown status (e.g. an enum value added later but not
    // yet in TASK_STATUSES) falls back to Todo rather than vanishing.
    const col = board[task.status] ? task.status : "Todo";
    board[col].push(task);
  }

  for (const status of TASK_STATUSES) {
    board[status].sort((a, b) => a.position - b.position);
  }

  return board;
}

/**
 * Next position value for a task dropped at the end of a column. Columns are
 * sparse-positioned (gaps are fine); we just need a value greater than the
 * current max so the card lands last.
 */
export function nextPositionInColumn(
  board: TaskBoard,
  status: TaskStatus,
): number {
  const col = board[status] ?? [];
  if (col.length === 0) return 0;
  return Math.max(...col.map((t) => t.position)) + 1;
}

export function isTaskStatus(x: unknown): x is TaskStatus {
  return typeof x === "string" && (TASK_STATUSES as readonly string[]).includes(x);
}

/**
 * Move `taskId` into `toStatus` at `targetIndex` (clamped; -1 or >= length
 * appends). Returns the updated flat task list — the target column renumbered
 * 0..n so ordering is dense — plus the column's ordered ids, which is exactly
 * the `orderedIds` payload for POST /api/tasks/:id/move.
 */
export function moveTaskInBoard(
  tasks: TaskCardModel[],
  taskId: string,
  toStatus: TaskStatus,
  targetIndex: number,
): { tasks: TaskCardModel[]; orderedIds: string[] } {
  const moved = tasks.find((t) => t.id === taskId);
  if (!moved) return { tasks, orderedIds: [] };

  const column = buildTaskBoard(tasks)[toStatus].filter((t) => t.id !== taskId);
  const index =
    targetIndex < 0 || targetIndex > column.length ? column.length : targetIndex;
  column.splice(index, 0, { ...moved, status: toStatus });

  const positionById = new Map(column.map((t, i) => [t.id, i]));
  return {
    tasks: tasks.map((t) => {
      const position = positionById.get(t.id);
      if (position === undefined) return t;
      return { ...t, status: toStatus, position };
    }),
    orderedIds: column.map((t) => t.id),
  };
}
