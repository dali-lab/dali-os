import { describe, it, expect } from "vitest";
import {
  BOARD_STATUSES,
  buildTaskBoard,
  taskMatchesQuery,
  moveTaskInBoard,
  nextPositionInColumn,
  isTaskFinished,
  type TaskCardModel,
} from "../task-board";

function task(
  id: string,
  status: TaskCardModel["status"],
  position: number,
): TaskCardModel {
  return {
    id,
    title: id,
    description: null,
    status,
    priority: "Normal",
    position,
    epicId: null,
    sprintId: null,
    carryoverCount: 0,
    checklist: null,
    assignees: [],
    domain: null,
    githubIssueUrl: null,
    githubIssueNumber: null,
    files: [],
    commentCount: 0,
    createdBy: { id: "u1", name: "U" },
    createdAt: "2026-07-01T00:00:00.000Z",
    activityAt: "2026-07-01T00:00:00.000Z",
    hasUnread: false,
  };
}

const TASKS = [
  task("a", "Todo", 0),
  task("b", "Todo", 1),
  task("c", "Todo", 2),
  task("d", "InProgress", 0),
];

describe("moveTaskInBoard", () => {
  it("reorders within a column with arrayMove semantics (down)", () => {
    const { tasks, orderedIds } = moveTaskInBoard(TASKS, "a", "Todo", 2);
    expect(orderedIds).toEqual(["b", "c", "a"]);
    const board = buildTaskBoard(tasks);
    expect(board.Todo.map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(board.Todo.map((t) => t.position)).toEqual([0, 1, 2]);
  });

  it("reorders within a column (up)", () => {
    const { orderedIds } = moveTaskInBoard(TASKS, "c", "Todo", 0);
    expect(orderedIds).toEqual(["c", "a", "b"]);
  });

  it("moves across columns at a target index", () => {
    const { tasks, orderedIds } = moveTaskInBoard(TASKS, "d", "Todo", 1);
    expect(orderedIds).toEqual(["a", "d", "b", "c"]);
    const moved = tasks.find((t) => t.id === "d")!;
    expect(moved.status).toBe("Todo");
    expect(moved.position).toBe(1);
    expect(buildTaskBoard(tasks).InProgress).toHaveLength(0);
  });

  it("appends when targetIndex is -1 or out of range", () => {
    expect(moveTaskInBoard(TASKS, "d", "Todo", -1).orderedIds).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(moveTaskInBoard(TASKS, "d", "Todo", 99).orderedIds).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("leaves untouched columns' tasks unmodified", () => {
    const { tasks } = moveTaskInBoard(TASKS, "a", "Todo", 2);
    expect(tasks.find((t) => t.id === "d")).toBe(TASKS[3]);
  });

  it("returns input unchanged for an unknown task", () => {
    const result = moveTaskInBoard(TASKS, "nope", "Todo", 0);
    expect(result.tasks).toBe(TASKS);
    expect(result.orderedIds).toEqual([]);
  });
});

describe("nextPositionInColumn", () => {
  it("is 0 for an empty column and max+1 otherwise", () => {
    const board = buildTaskBoard(TASKS);
    expect(nextPositionInColumn(board, "Done")).toBe(0);
    expect(nextPositionInColumn(board, "Todo")).toBe(3);
  });
});


describe("taskMatchesQuery", () => {
  const searchable = (over: Partial<TaskCardModel>): TaskCardModel => ({
    ...task("t1", "Todo", 0),
    title: "Fix login redirect",
    description: "Bounces back to the landing page after CAS",
    assignees: [{ id: "u2", name: "Sophie Park" }],
    domain: { id: "d1", name: "Software" },
    ...over,
  });

  it("matches an empty or whitespace-only query", () => {
    expect(taskMatchesQuery(searchable({}), "")).toBe(true);
    expect(taskMatchesQuery(searchable({}), "   ")).toBe(true);
  });

  it("matches on title, description, assignee and domain, case-insensitively", () => {
    const t = searchable({});
    expect(taskMatchesQuery(t, "LOGIN")).toBe(true);
    expect(taskMatchesQuery(t, "cas")).toBe(true);
    expect(taskMatchesQuery(t, "sophie")).toBe(true);
    expect(taskMatchesQuery(t, "software")).toBe(true);
    expect(taskMatchesQuery(t, "figma")).toBe(false);
  });

  it("requires every token to land, so extra words narrow the result", () => {
    const t = searchable({});
    expect(taskMatchesQuery(t, "login sophie")).toBe(true);
    expect(taskMatchesQuery(t, "login rachel")).toBe(false);
  });

  it("handles a task with no description, assignees or domain", () => {
    const bare = searchable({ description: null, assignees: [], domain: null });
    expect(taskMatchesQuery(bare, "login")).toBe(true);
    expect(taskMatchesQuery(bare, "sophie")).toBe(false);
  });
});


describe("moveTaskInBoard — sprint scope", () => {
  it("orders only among in-scope tasks, leaving other sprints' positions alone", () => {
    const tasks = [
      { ...task("a", "Todo", 0), sprintId: "S1" },
      { ...task("b", "Todo", 1), sprintId: "S1" },
      { ...task("x", "Todo", 0), sprintId: "S2" },
    ];
    const res = moveTaskInBoard(tasks, "b", "Todo", 0, (t) => t.sprintId === "S1");
    expect(res.orderedIds).toEqual(["b", "a"]);
    expect(res.tasks.find((t) => t.id === "x")!.position).toBe(0);
  });
});

describe("BOARD_STATUSES / isTaskFinished", () => {
  it("draws no Backlog column", () => {
    expect(BOARD_STATUSES).toEqual(["Todo", "InProgress", "InReview", "Done", "Cancelled"]);
  });
  it("treats Done and Cancelled as finished", () => {
    expect(isTaskFinished({ status: "Done" })).toBe(true);
    expect(isTaskFinished({ status: "Cancelled" })).toBe(true);
    expect(isTaskFinished({ status: "InReview" })).toBe(false);
  });
});
