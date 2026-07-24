// Pure helpers for the project task board. Mirrors the shape conventions in
// staffing-board.ts: route loaders pass plain data in, the component renders
// the board the helper builds, and persistence goes through an /api route.

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
  epicId: string | null;
  sprintId: string | null;
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
  createdBy: { id: string; name: string };
  // ISO timestamp (UTC).
  createdAt: string;
};

export type BoardSprint = {
  id: string;
  name: string;
  status: "Planned" | "Active" | "Closed";
  // The epic this sprint belongs to (null = standalone). Powers the modal's
  // cascading Epic → Sprint picker: pick an epic, then only its sprints show.
  epicId: string | null;
  // The Term this sprint falls in, resolved from its start date by the loader
  // (see resolveTermIdForDate). Null when the Term table has no term at or
  // after the sprint's start. Powers the board's term filter.
  termId: string | null;
};

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
  // The project's sprints/epics: the board's sprint filter pills and the
  // modal's sprint/epic pickers. Sprints ordered Active → Planned → Closed.
  sprints: BoardSprint[];
  epics: BoardEpic[];
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
