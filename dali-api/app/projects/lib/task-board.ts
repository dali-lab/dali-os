// Pure helpers for the project task board. Mirrors the shape conventions in
// staffing-board.ts: route loaders pass plain data in, the component renders
// the board the helper builds, and persistence goes through an /api route.

export const TASK_STATUSES = [
  "Todo",
  "InProgress",
  "InReview",
  "Done",
  "Cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
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
  status: TaskStatus;
  priority: Priority;
  position: number;
  // ISO timestamp (UTC) or null. The pill on TaskCard formats it for display.
  // Stored as a string here so the model serializes cleanly through the
  // loader → client boundary without a Date round-trip.
  dueAt: string | null;
  epicId: string | null;
  sprintId: string | null;
  // Each assignee with id + display name. Id powers the modal's assignee
  // dropdown; name powers the card chip.
  assignees: { id: string; name: string }[];
  // Optional domain label on the task itself (Domain.code/displayName).
  // Independent of who's assigned.
  domain: { id: string; name: string } | null;
};

// Choices the TaskModal needs to populate its assignee + domain dropdowns.
// Loader fetches once per board render and passes through to TaskBoard.
export type TaskBoardOptions = {
  members: { id: string; name: string }[];
  domains: { id: string; name: string }[];
};

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
