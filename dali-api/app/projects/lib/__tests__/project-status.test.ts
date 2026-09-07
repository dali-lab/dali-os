import { describe, it, expect } from "vitest";
import {
  computeProjectStatus,
  factsFingerprint,
  buildTldrDetail,
  STALE_DAYS,
  type StatusTaskInput,
  type StatusSprintInput,
  type TldrTaskInput,
} from "../project-status";

const NOW = new Date("2026-09-07T12:00:00.000Z");

function task(over: Partial<StatusTaskInput>): StatusTaskInput {
  return {
    id: "t",
    status: "Todo",
    dueAt: null,
    sprintId: "sprint-1",
    activityAt: NOW,
    ...over,
  };
}

function detailTask(over: Partial<TldrTaskInput>): TldrTaskInput {
  return {
    id: "t",
    title: "Task",
    status: "Todo",
    priority: "Normal",
    dueAt: null,
    sprintId: "sprint-1",
    activityAt: NOW,
    assigneeIds: [],
    ...over,
  };
}

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function compute(tasks: StatusTaskInput[], sprints: StatusSprintInput[] = []) {
  return computeProjectStatus(
    { projectStatus: "Active", tasks, sprints },
    NOW,
  );
}

describe("computeProjectStatus — progress totals", () => {
  it("counts Done toward completion and excludes Cancelled from the total", () => {
    const facts = compute([
      task({ status: "Done" }),
      task({ status: "Done" }),
      task({ status: "Todo" }),
      task({ status: "Cancelled" }),
    ]);
    expect(facts.totalTasks).toBe(3); // the Cancelled one drops out
    expect(facts.doneTasks).toBe(2);
  });

  it("reports hasWork=false and null active sprint for an empty project", () => {
    const facts = compute([]);
    expect(facts.hasWork).toBe(false);
    expect(facts.totalTasks).toBe(0);
    expect(facts.activeSprint).toBeNull();
  });

  it("reports hasWork=true when there are sprints but no tasks", () => {
    const facts = compute([], [
      { id: "s", name: "Sprint 1", startsAt: "2026-09-01", endsAt: "2026-09-14", status: "Active" },
    ]);
    expect(facts.hasWork).toBe(true);
  });
});

describe("computeProjectStatus — overdue", () => {
  it("counts non-closed tasks past due, and ignores closed or future ones", () => {
    const facts = compute([
      task({ status: "Todo", dueAt: "2026-09-01" }), // overdue
      task({ status: "InProgress", dueAt: "2026-09-06T00:00:00Z" }), // overdue
      task({ status: "Todo", dueAt: "2026-12-01" }), // future — not overdue
      task({ status: "Done", dueAt: "2026-01-01" }), // closed — not overdue
      task({ status: "Cancelled", dueAt: "2026-01-01" }), // closed — not overdue
      task({ status: "Todo", dueAt: null }), // no due date
    ]);
    expect(facts.overdue).toBe(2);
  });
});

describe("computeProjectStatus — unscheduled", () => {
  it("flags in-motion tasks with no sprint but not Backlog or scheduled work", () => {
    const facts = compute([
      task({ status: "Todo", sprintId: null }), // unscheduled
      task({ status: "InProgress", sprintId: null }), // unscheduled
      task({ status: "InReview", sprintId: null }), // unscheduled
      task({ status: "Backlog", sprintId: null }), // parked — not flagged
      task({ status: "Todo", sprintId: "s1" }), // scheduled
      task({ status: "Done", sprintId: null }), // closed
    ]);
    expect(facts.unscheduled).toBe(3);
  });
});

describe("computeProjectStatus — in review", () => {
  it("counts InReview tasks", () => {
    const facts = compute([
      task({ status: "InReview" }),
      task({ status: "InReview" }),
      task({ status: "Todo" }),
    ]);
    expect(facts.inReview).toBe(2);
  });
});

describe("computeProjectStatus — stale", () => {
  const staleDate = new Date(NOW.getTime() - (STALE_DAYS + 1) * 24 * 60 * 60 * 1000);
  const freshDate = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);

  it("flags InProgress tasks untouched past the stale window only", () => {
    const facts = compute([
      task({ status: "InProgress", activityAt: staleDate }), // stale
      task({ status: "InProgress", activityAt: freshDate }), // fresh
      task({ status: "Todo", activityAt: staleDate }), // not InProgress — not stale
      task({ status: "Done", activityAt: staleDate }), // closed — not stale
    ]);
    expect(facts.stale).toBe(1);
  });
});

describe("computeProjectStatus — active sprint", () => {
  it("prefers an explicitly Active sprint, choosing the soonest to end", () => {
    const facts = compute([], [
      { id: "late", name: "Late", startsAt: "2026-09-01", endsAt: "2026-09-30", status: "Active" },
      { id: "soon", name: "Soon", startsAt: "2026-09-01", endsAt: "2026-09-12", status: "Active" },
      { id: "closed", name: "Closed", startsAt: "2026-08-01", endsAt: "2026-08-14", status: "Closed" },
    ]);
    expect(facts.activeSprint?.id).toBe("soon");
    expect(facts.activeSprint?.daysRemaining).toBe(5); // Sep 7 12:00 → Sep 12 00:00, ceil
  });

  it("falls back to an unclosed sprint whose window contains now", () => {
    const facts = compute([], [
      { id: "current", name: "Current", startsAt: "2026-09-01", endsAt: "2026-09-14", status: "Planned" },
      { id: "future", name: "Future", startsAt: "2026-10-01", endsAt: "2026-10-14", status: "Planned" },
    ]);
    expect(facts.activeSprint?.id).toBe("current");
  });

  it("returns a negative daysRemaining once the active sprint is past its end", () => {
    const facts = compute([], [
      { id: "over", name: "Overrun", startsAt: "2026-08-01", endsAt: "2026-09-05", status: "Active" },
    ]);
    expect(facts.activeSprint?.id).toBe("over");
    expect(facts.activeSprint?.daysRemaining).toBeLessThan(0);
  });
});

describe("factsFingerprint", () => {
  it("is stable for identical facts and changes when a flag count changes", () => {
    const base = compute([task({ id: "a", status: "Todo", dueAt: "2026-09-01" })]);
    const same = compute([task({ id: "a", status: "Todo", dueAt: "2026-09-01" })]);
    const more = compute([
      task({ id: "a", status: "Todo", dueAt: "2026-09-01" }),
      task({ id: "b", status: "Todo", dueAt: "2026-09-02" }),
    ]);
    expect(factsFingerprint(base)).toBe(factsFingerprint(same));
    expect(factsFingerprint(base)).not.toBe(factsFingerprint(more));
  });

  it("changes when a different task becomes overdue even at the same count", () => {
    const a = compute([task({ id: "a", status: "Todo", dueAt: "2026-09-01" })]);
    const b = compute([task({ id: "b", status: "Todo", dueAt: "2026-09-01" })]);
    // Same count (1 overdue), different identity — the AI names specifics, so
    // the summary must be allowed to regenerate.
    expect(a.overdue).toBe(b.overdue);
    expect(factsFingerprint(a)).not.toBe(factsFingerprint(b));
  });
});

describe("buildTldrDetail", () => {
  it("names overdue tasks most-overdue-first with priority + days, excluding closed", () => {
    const detail = buildTldrDetail(
      [
        detailTask({ id: "1", title: "Old", status: "Todo", priority: "High", dueAt: daysAgo(10) }),
        detailTask({ id: "2", title: "Older", status: "InProgress", priority: "Urgent", dueAt: daysAgo(30) }),
        detailTask({ id: "3", title: "Shipped", status: "Done", priority: "High", dueAt: daysAgo(50) }),
      ],
      NOW,
    );
    expect(detail.overdue.map((o) => o.title)).toEqual(["Older", "Old"]);
    expect(detail.overdue[0]).toMatchObject({ priority: "Urgent", daysOver: 30 });
  });

  it("counts open priority mix, distinct team size, and unscheduled high-priority", () => {
    const detail = buildTldrDetail(
      [
        detailTask({ id: "1", status: "InProgress", priority: "Urgent", sprintId: null, assigneeIds: ["u1", "u2"] }),
        detailTask({ id: "2", status: "Todo", priority: "High", sprintId: null, assigneeIds: ["u2"] }),
        detailTask({ id: "3", status: "Todo", priority: "High", sprintId: "s1", assigneeIds: ["u3"] }),
        detailTask({ id: "4", status: "Done", priority: "Urgent", assigneeIds: ["u4"] }),
      ],
      NOW,
    );
    expect(detail.urgentOpen).toBe(1);
    expect(detail.highOpen).toBe(2);
    expect(detail.unscheduledHighPriority).toBe(2);
    expect(detail.teamSize).toBe(4);
  });

  it("lists only stalled InProgress tasks (longest-first) and in-review titles", () => {
    const detail = buildTldrDetail(
      [
        detailTask({ id: "1", title: "Stuck", status: "InProgress", activityAt: daysAgo(STALE_DAYS + 5) }),
        detailTask({ id: "2", title: "Fresh", status: "InProgress", activityAt: daysAgo(2) }),
        detailTask({ id: "3", title: "Reviewing", status: "InReview" }),
      ],
      NOW,
    );
    expect(detail.stale.map((s) => s.title)).toEqual(["Stuck"]);
    expect(detail.inReview).toEqual(["Reviewing"]);
  });
});
