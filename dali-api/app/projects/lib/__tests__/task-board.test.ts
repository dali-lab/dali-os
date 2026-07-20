import { describe, it, expect } from "vitest";
import {
  buildTaskBoard,
  moveTaskInBoard,
  nextPositionInColumn,
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
    dueAt: null,
    epicId: null,
    sprintId: null,
    checklist: null,
    assignees: [],
    domain: null,
    githubIssueUrl: null,
    githubIssueNumber: null,
    files: [],
    createdBy: { id: "u1", name: "U" },
    createdAt: "2026-07-01T00:00:00.000Z",
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
