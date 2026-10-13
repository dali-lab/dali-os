import { describe, it, expect } from "vitest";
import {
  activeSprintOf,
  computeProjectStatus,
  computeStatusBreakdown,
  factsFingerprint,
  buildTldrDetail,
  BREAKDOWN_CAP,
  STALE_DAYS,
  type StatusTaskInput,
  type TldrTaskInput,
} from "../project-status";
import type { SprintModel } from "../sprints";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const TODAY = Date.UTC(2026, 8, 9);

const sprint = (n: number, startsOn: string, endsOn: string, closed = false): SprintModel => ({
  id: `s${n}`,
  number: n,
  termId: "26F",
  termCode: "26F",
  startsOn: `${startsOn}T00:00:00.000Z`,
  endsOn: `${endsOn}T00:00:00.000Z`,
  closed,
  plannedCount: null,
  completedCount: null,
  carriedOverCount: null,
});
const SPRINTS = [
  sprint(1, "2026-09-07", "2026-09-13"),
  sprint(2, "2026-09-14", "2026-09-20"),
];

function task(over: Partial<StatusTaskInput>): StatusTaskInput {
  return { id: "t", status: "Todo", sprintId: "s1", carryoverCount: 0, activityAt: NOW, ...over };
}

function detailTask(over: Partial<TldrTaskInput>): TldrTaskInput {
  return {
    id: "t",
    title: "Task",
    status: "Todo",
    priority: "Normal",
    sprintId: "s1",
    carryoverCount: 0,
    activityAt: NOW,
    assigneeIds: [],
    ...over,
  };
}

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function compute(tasks: StatusTaskInput[], sprints: SprintModel[] = []) {
  return computeProjectStatus({ projectStatus: "Active", tasks, sprints }, NOW, TODAY);
}

describe("computeProjectStatus — progress totals", () => {
  it("counts Done toward completion and excludes Cancelled from the total", () => {
    const f = compute([
      task({ id: "a", status: "Done" }),
      task({ id: "b", status: "Todo" }),
      task({ id: "c", status: "Cancelled" }),
    ]);
    expect(f).toMatchObject({ totalTasks: 2, doneTasks: 1, hasWork: true });
  });

  it("reports hasWork=false and no active sprint for an empty project", () => {
    expect(compute([])).toMatchObject({ hasWork: false, activeSprint: null });
  });
});

describe("computeProjectStatus — carried over", () => {
  it("counts open tasks that rolled at least once, not finished ones", () => {
    const f = compute([
      task({ id: "b", carryoverCount: 2 }),
      task({ id: "a", carryoverCount: 1, status: "InProgress" }),
      task({ id: "done", carryoverCount: 3, status: "Done" }),
      task({ id: "fresh" }),
    ]);
    expect(f.carried).toBe(2);
    expect(f.carriedIds).toEqual(["a", "b"]);
  });
});

describe("computeProjectStatus — unscheduled", () => {
  it("flags started work sitting in the backlog, not planned To-dos", () => {
    const f = compute([
      task({ id: "a", status: "InProgress", sprintId: null }),
      task({ id: "b", status: "InReview", sprintId: null }),
      task({ id: "c", status: "Todo", sprintId: null }),
      task({ id: "d", status: "InProgress" }),
    ]);
    expect(f.unscheduled).toBe(2);
  });
});

describe("computeProjectStatus — in review / stale", () => {
  it("counts InReview tasks", () => {
    expect(compute([task({ status: "InReview" }), task({ id: "x" })]).inReview).toBe(1);
  });

  it("flags InProgress tasks untouched past the stale window only", () => {
    const f = compute([
      task({ id: "old", status: "InProgress", activityAt: daysAgo(STALE_DAYS + 1) }),
      task({ id: "new", status: "InProgress", activityAt: daysAgo(STALE_DAYS - 1) }),
      task({ id: "todo", status: "Todo", activityAt: daysAgo(STALE_DAYS + 5) }),
    ]);
    expect(f.staleIds).toEqual(["old"]);
  });
});

describe("computeProjectStatus — active sprint", () => {
  it("reads the stored sprint containing today, with days left", () => {
    const f = compute([], SPRINTS);
    expect(f.activeSprint).toEqual({
      label: "Sprint 1",
      startsAt: "2026-09-07T00:00:00.000Z",
      endsAt: "2026-09-14T00:00:00.000Z",
      daysRemaining: 5,
    });
  });

  it("is null in a break or when the sprint is already closed", () => {
    expect(compute([], [sprint(2, "2026-09-14", "2026-09-20")]).activeSprint).toBeNull();
    expect(compute([], [sprint(1, "2026-09-07", "2026-09-13", true)]).activeSprint).toBeNull();
  });
});

describe("activeSprintOf", () => {
  it("picks the running sprint only", () => {
    expect(activeSprintOf(SPRINTS, TODAY)!.id).toBe("s1");
    expect(activeSprintOf(SPRINTS, Date.UTC(2026, 8, 30))).toBeNull();
  });
});

describe("factsFingerprint", () => {
  it("is stable for identical facts and changes when a flag count changes", () => {
    const a = factsFingerprint(compute([task({})]));
    expect(factsFingerprint(compute([task({})]))).toBe(a);
    expect(factsFingerprint(compute([task({ status: "InReview" })]))).not.toBe(a);
  });

  it("changes when a different task is carried at the same count", () => {
    const a = factsFingerprint(compute([task({ id: "a", carryoverCount: 1 }), task({ id: "b" })]));
    const b = factsFingerprint(compute([task({ id: "a" }), task({ id: "b", carryoverCount: 1 })]));
    expect(a).not.toBe(b);
  });

  it("changes when the active sprint changes", () => {
    const a = factsFingerprint(compute([task({})], SPRINTS));
    const b = factsFingerprint(compute([task({})], []));
    expect(a).not.toBe(b);
  });
});

describe("buildTldrDetail", () => {
  it("names carried tasks most-rolled-first with priority, excluding closed", () => {
    const d = buildTldrDetail(
      [
        detailTask({ title: "Once", carryoverCount: 1 }),
        detailTask({ title: "Thrice", carryoverCount: 3, priority: "High" }),
        detailTask({ title: "Done", carryoverCount: 5, status: "Done" }),
      ],
      NOW,
    );
    expect(d.carried).toEqual([
      { title: "Thrice", priority: "High", times: 3 },
      { title: "Once", priority: "Normal", times: 1 },
    ]);
  });

  it("counts open priority mix, distinct team size, and unscheduled high-priority", () => {
    const d = buildTldrDetail(
      [
        detailTask({ priority: "Urgent", assigneeIds: ["u1"] }),
        detailTask({ priority: "High", assigneeIds: ["u1", "u2"], status: "InProgress", sprintId: null }),
        detailTask({ priority: "High", status: "Done", assigneeIds: ["u3"] }),
      ],
      NOW,
    );
    expect(d).toMatchObject({ urgentOpen: 1, highOpen: 1, unscheduledHighPriority: 1, teamSize: 3 });
  });

  it("lists only stalled InProgress tasks (longest-first) and in-review titles", () => {
    const d = buildTldrDetail(
      [
        detailTask({ title: "A", status: "InProgress", activityAt: daysAgo(STALE_DAYS + 1) }),
        detailTask({ title: "B", status: "InProgress", activityAt: daysAgo(STALE_DAYS + 9) }),
        detailTask({ title: "R", status: "InReview" }),
      ],
      NOW,
    );
    expect(d.stale.map((s) => s.title)).toEqual(["B", "A"]);
    expect(d.inReview).toEqual(["R"]);
  });
});

describe("computeStatusBreakdown", () => {
  it("buckets tasks by status in display order, omitting empty buckets and Cancelled", () => {
    const b = computeStatusBreakdown(
      [
        { ...detailTask({ status: "Todo" }) },
        { ...detailTask({ status: "Done" }) },
        { ...detailTask({ status: "Cancelled" }) },
      ],
      NOW,
    );
    expect(b.byStatus.map((s) => s.status)).toEqual(["Done", "Todo"]);
  });

  it("names carried tasks most-rolled-first and unscheduled started work by priority", () => {
    const b = computeStatusBreakdown(
      [
        detailTask({ title: "c1", carryoverCount: 1 }),
        detailTask({ title: "c2", carryoverCount: 2 }),
        detailTask({ title: "u-low", priority: "Low", status: "InProgress", sprintId: null }),
        detailTask({ title: "u-urgent", priority: "Urgent", status: "InReview", sprintId: null }),
        detailTask({ title: "parked", status: "Todo", sprintId: null }),
      ],
      NOW,
    );
    expect(b.carried.map((c) => c.title)).toEqual(["c2", "c1"]);
    expect(b.unscheduled.map((u) => u.title)).toEqual(["u-urgent", "u-low"]);
  });

  it("caps each named list at BREAKDOWN_CAP", () => {
    const many = Array.from({ length: BREAKDOWN_CAP + 3 }, (_, i) =>
      detailTask({ id: `t${i}`, title: `t${i}`, carryoverCount: 1 }),
    );
    expect(computeStatusBreakdown(many, NOW).carried).toHaveLength(BREAKDOWN_CAP);
  });
});
