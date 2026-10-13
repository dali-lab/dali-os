// Pure helpers for the project task board: loaders pass plain data in, the
// component renders the board these build, persistence goes through /api.

import type { SprintModel } from "./sprints";

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
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  position: number;
  // Null only for rows the per-project backfill hasn't reached yet.
  epicId: string | null;
  // Null = the project backlog.
  sprintId: string | null;
  // Times this task rolled into a following sprint unfinished.
  carryoverCount: number;
  checklist: { text: string; done: boolean }[] | null;
  assignees: { id: string; name: string }[];
  domain: { id: string; name: string } | null;
  githubIssueUrl: string | null;
  githubIssueNumber: number | null;
  files: { id: string; title: string; versionCount: number }[];
  commentCount: number;
  createdBy: { id: string; name: string };
  createdAt: string;
  activityAt: string;
  // activityAt is newer than the viewer's last open of this task.
  hasUnread: boolean;
};

/** The columns a sprint board draws, in flow order. Backlog is not a column. */
export const BOARD_STATUSES = ["Todo", "InProgress", "InReview", "Done", "Cancelled"] as const satisfies readonly TaskStatus[];

export type BoardEpic = { id: string; title: string };

export type TaskBoardOptions = {
  // `domainId` is the member's staffed domain here — the modal autofills it.
  members: { id: string; name: string; photoUrl: string | null; domainId: string | null }[];
  domains: { id: string; name: string }[];
  // Non-empty shows the modal's "Create GitHub issue" picker.
  repoUrls: string[];
  epics: BoardEpic[];
  projectFiles: { id: string; title: string }[];
  sprints: SprintModel[];
  anchors: SprintAnchor[];
};

export type SprintAnchor = { termId: string; termCode: string; anchorDay: number };

/** Done or Cancelled. */
export function isTaskFinished(task: { status: string }): boolean {
  return task.status === "Done" || task.status === "Cancelled";
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
 * appends), ordering only among tasks `inScope` (the board's sprint). Returns
 * the updated flat task list — the target column renumbered
 * 0..n so ordering is dense — plus the column's ordered ids, which is exactly
 * the `orderedIds` payload for POST /api/tasks/:id/move.
 */
export function moveTaskInBoard(
  tasks: TaskCardModel[],
  taskId: string,
  toStatus: TaskStatus,
  targetIndex: number,
  inScope: (t: TaskCardModel) => boolean = () => true,
): { tasks: TaskCardModel[]; orderedIds: string[] } {
  const moved = tasks.find((t) => t.id === taskId);
  if (!moved) return { tasks, orderedIds: [] };

  const column = buildTaskBoard(tasks.filter(inScope))[toStatus].filter((t) => t.id !== taskId);
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
