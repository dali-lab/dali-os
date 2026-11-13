import { describe, expect, it } from "vitest";
import {
  countRolledOver,
  moveTaskPatch,
  placeTasksInWeek,
  rolledFromLabel,
  type BoardTask,
} from "../rollover";
import type { BoardPeriod } from "../weeks";

const fall: BoardPeriod = {
  id: "f", name: "Fall 2026", shortName: "26F", kind: "Term",
  startDate: "2026-09-13", weekCount: 10,
};
const interim: BoardPeriod = {
  id: "i", name: "Interim", shortName: "Int", kind: "Interim",
  startDate: "2026-11-22", weekCount: 6,
};
const periods = [fall, interim];
const current = { periodId: "f", week: 8 };

function task(over: Partial<BoardTask> & { id: string }): BoardTask {
  return {
    periodId: "f", week: 8, status: "Todo", assigneeIds: ["u1"], ...over,
  };
}

const place = (tasks: BoardTask[], viewed = current, cur = current) =>
  placeTasksInWeek({ tasks, periods, viewed, current: cur });

describe("placeTasksInWeek", () => {
  it("shows tasks planned for the viewed week without a badge", () => {
    const out = place([task({ id: "a" })]);
    expect(out).toEqual([{ ...task({ id: "a" }), rolledFrom: null }]);
  });

  it("rolls open tasks from earlier weeks into the current week", () => {
    const out = place([
      task({ id: "todo", week: 7, status: "Todo" }),
      task({ id: "doing", week: 3, status: "Doing" }),
    ]);
    expect(out.map((t) => [t.id, t.rolledFrom])).toEqual([
      ["todo", { periodId: "f", week: 7 }],
      ["doing", { periodId: "f", week: 3 }],
    ]);
    expect(countRolledOver(out)).toBe(2);
  });

  it("does not roll done or backlog tasks", () => {
    const out = place([
      task({ id: "done", week: 7, status: "Done" }),
      task({ id: "back", week: 7, status: "Backlog" }),
    ]);
    expect(out).toEqual([]);
  });

  it("shows done tasks in their original past week", () => {
    const viewed = { periodId: "f", week: 7 };
    const out = place([task({ id: "done", week: 7, status: "Done" })], viewed);
    expect(out.map((t) => t.id)).toEqual(["done"]);
  });

  it("does not show an overdue open task in its original past week", () => {
    const viewed = { periodId: "f", week: 7 };
    expect(place([task({ id: "late", week: 7 })], viewed)).toEqual([]);
  });

  it("does not roll tasks into a future week view", () => {
    const viewed = { periodId: "f", week: 9 };
    const out = place(
      [task({ id: "late", week: 7 }), task({ id: "next", week: 9 })],
      viewed,
    );
    expect(out.map((t) => t.id)).toEqual(["next"]);
  });

  it("rolls across a term boundary and keeps the original period", () => {
    const cur = { periodId: "i", week: 1 };
    const out = place([task({ id: "x", week: 10 })], cur, cur);
    expect(out[0].rolledFrom).toEqual({ periodId: "f", week: 10 });
  });

  it("skips tasks whose period no longer exists", () => {
    expect(place([task({ id: "x", periodId: "gone" })])).toEqual([]);
  });

  it("returns nothing when the viewed period is unknown", () => {
    expect(place([task({ id: "a" })], { periodId: "gone", week: 1 })).toEqual([]);
  });
});

describe("rolledFromLabel", () => {
  it("uses a short label inside the same period", () => {
    expect(rolledFromLabel({ periodId: "f", week: 7 }, periods, "f")).toBe("From wk 7");
  });

  it("names the earlier period when it differs", () => {
    expect(rolledFromLabel({ periodId: "f", week: 10 }, periods, "i")).toBe("From 26F wk 10");
  });
});

describe("moveTaskPatch", () => {
  const now = new Date("2026-11-04T12:00:00Z");

  it("moving to a board status pins the task to the viewed week", () => {
    expect(
      moveTaskPatch(
        { assigneeIds: ["u2"], status: "Backlog" },
        { status: "Todo", periodId: "f", week: 8 },
        "me",
        now,
      ),
    ).toEqual({ status: "Todo", periodId: "f", week: 8, completedAt: null });
  });

  it("assigns the actor when the task had no assignee", () => {
    const patch = moveTaskPatch(
      { assigneeIds: [], status: "Backlog" },
      { status: "Doing", periodId: "f", week: 8 },
      "me",
      now,
    );
    expect(patch.assigneeIds).toEqual(["me"]);
  });

  it("stamps completedAt on Done and clears it on undo", () => {
    expect(
      moveTaskPatch({ assigneeIds: ["u"], status: "Doing" }, { status: "Done", periodId: "f", week: 8 }, "me", now)
        .completedAt,
    ).toEqual(now);
    expect(
      moveTaskPatch({ assigneeIds: ["u"], status: "Done" }, { status: "Doing", periodId: "f", week: 8 }, "me", now)
        .completedAt,
    ).toBeNull();
  });

  it("backlog keeps its planned week and assignee", () => {
    expect(
      moveTaskPatch({ assigneeIds: [], status: "Todo" }, { status: "Backlog", periodId: "f", week: 8 }, "me", now),
    ).toEqual({ status: "Backlog", completedAt: null });
  });
});
