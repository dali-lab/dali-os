import { describe, it, expect } from "vitest";
import { BACKLOG_COLUMN, planBacklogMove, rankedBacklog } from "../backlog";
import type { TaskCardModel } from "../task-board";

const t = (id: string, extra: Partial<TaskCardModel> = {}): TaskCardModel => ({
  id,
  title: id,
  description: null,
  status: "Todo",
  priority: "Normal",
  position: 0,
  epicId: "e1",
  sprintId: null,
  carryoverCount: 0,
  checklist: null,
  assignees: [],
  domain: null,
  githubIssueUrl: null,
  githubIssueNumber: null,
  files: [],
  commentCount: 0,
  createdBy: { id: "u", name: "U" },
  createdAt: "2026-10-01T00:00:00.000Z",
  activityAt: "2026-10-01T00:00:00.000Z",
  hasUnread: false,
  ...extra,
});

const tasks = [
  t("a", { position: 0 }),
  t("b", { position: 1 }),
  t("c", { position: 2 }),
  t("done", { position: 3, status: "Done" }),
  t("s1", { sprintId: "S", position: 0 }),
  t("s2", { sprintId: "S", position: 4, status: "InProgress" }),
];

describe("rankedBacklog", () => {
  it("is open, sprintless tasks by position", () => {
    expect(rankedBacklog(tasks).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});

describe("planBacklogMove", () => {
  it("re-ranks within the backlog by dropping on a card", () => {
    const plan = planBacklogMove(tasks, "c", "a")!;
    expect(plan.body).toEqual({ status: "Todo", orderedIds: ["c", "a", "b"] });
    expect(rankedBacklog(plan.tasks).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("is a no-op when the backlog order doesn't change", () => {
    expect(planBacklogMove(tasks, "c", BACKLOG_COLUMN)).toBeNull();
    expect(planBacklogMove(tasks, "a", "a")).toBeNull();
  });

  it("schedules a backlog task at the end of its status column in the sprint", () => {
    const plan = planBacklogMove(tasks, "b", "S")!;
    expect(plan.body).toEqual({ status: "Todo", position: 1, sprintId: "S" });
    expect(plan.tasks.find((x) => x.id === "b")).toMatchObject({ sprintId: "S", position: 1 });
  });

  it("schedules by dropping on a card inside the sprint", () => {
    const plan = planBacklogMove(tasks, "a", "s2")!;
    expect(plan.body).toMatchObject({ sprintId: "S" });
  });

  it("unschedules a sprint task into the backlog at the drop slot", () => {
    const plan = planBacklogMove(tasks, "s1", "b")!;
    expect(plan.body).toEqual({ status: "Todo", orderedIds: ["a", "s1", "b", "c"], sprintId: null });
    expect(plan.tasks.find((x) => x.id === "s1")).toMatchObject({ sprintId: null, position: 1 });
  });

  it("ignores drops within the same sprint and unknown tasks", () => {
    expect(planBacklogMove(tasks, "s1", "S")).toBeNull();
    expect(planBacklogMove(tasks, "nope", "S")).toBeNull();
  });
});
