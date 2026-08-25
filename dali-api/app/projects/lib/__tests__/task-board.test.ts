import { describe, it, expect } from "vitest";
import {
  buildTaskBoard,
  taskMatchesQuery,
  moveTaskInBoard,
  nextPositionInColumn,
  resolveTermIdForDate,
  termIdsInRange,
  type TaskCardModel,
  type TermWindow,
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
    startsAt: null,
    epicId: null,
    sprintId: null,
    storyId: null,
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

// Three consecutive terms with a one-week gap between each (the inter-term
// break). Ascending, as the resolvers require.
const TERMS: TermWindow[] = [
  {
    id: "spring",
    startDate: new Date("2026-03-30T00:00:00.000Z"),
    endDate: new Date("2026-06-01T00:00:00.000Z"),
  },
  {
    id: "summer",
    startDate: new Date("2026-06-22T00:00:00.000Z"),
    endDate: new Date("2026-08-31T00:00:00.000Z"),
  },
  {
    id: "fall",
    startDate: new Date("2026-09-14T00:00:00.000Z"),
    endDate: new Date("2026-12-01T00:00:00.000Z"),
  },
];

describe("resolveTermIdForDate", () => {
  it("resolves a date inside a term's window to that term", () => {
    expect(resolveTermIdForDate(TERMS, new Date("2026-07-15T00:00:00Z"))).toBe(
      "summer",
    );
  });

  it("rolls a break-week date forward to the next term", () => {
    // Between Spring's end and Summer's start — counts toward Summer.
    expect(resolveTermIdForDate(TERMS, new Date("2026-06-10T00:00:00Z"))).toBe(
      "summer",
    );
  });

  it("resolves a date before every term to the first term", () => {
    expect(resolveTermIdForDate(TERMS, new Date("2026-01-01T00:00:00Z"))).toBe(
      "spring",
    );
  });

  it("returns null for a date after the last term ends", () => {
    expect(
      resolveTermIdForDate(TERMS, new Date("2027-01-01T00:00:00Z")),
    ).toBeNull();
  });

  it("treats the endDate boundary as still in-term", () => {
    expect(resolveTermIdForDate(TERMS, TERMS[0].endDate)).toBe("spring");
  });
});

describe("termIdsInRange", () => {
  it("returns terms whose windows overlap the span", () => {
    expect(
      termIdsInRange(
        TERMS,
        new Date("2026-05-15T00:00:00Z"),
        new Date("2026-07-15T00:00:00Z"),
      ),
    ).toEqual(["spring", "summer"]);
  });

  it("treats a null start as open-ended on the left", () => {
    expect(
      termIdsInRange(TERMS, null, new Date("2026-06-25T00:00:00Z")),
    ).toEqual(["spring", "summer"]);
  });

  it("treats a null end as open-ended on the right", () => {
    expect(
      termIdsInRange(TERMS, new Date("2026-08-01T00:00:00Z"), null),
    ).toEqual(["summer", "fall"]);
  });

  it("returns nothing when both bounds are null (no dated span)", () => {
    expect(termIdsInRange(TERMS, null, null)).toEqual([]);
  });

  it("returns a single term for a span fully inside one window", () => {
    expect(
      termIdsInRange(
        TERMS,
        new Date("2026-07-01T00:00:00Z"),
        new Date("2026-07-10T00:00:00Z"),
      ),
    ).toEqual(["summer"]);
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
