import { describe, it, expect } from "vitest";
import {
  computeProjectStatus,
  computeStatusBreakdown,
  BREAKDOWN_CAP,
  STALE_DAYS,
  type StatusTaskInput,
  type BreakdownTaskInput,
} from "../project-status";
import type { TimelineTermSpan } from "../timeline-days";

const NOW = new Date("2026-09-07T12:00:00.000Z");

// A 10-week fall term whose Sprint 1 opens on the day NOW falls in.
const TERMS: TimelineTermSpan[] = [
  { code: "26F", startsAt: "2026-09-07T00:00:00.000Z", endsAt: "2026-11-15T00:00:00.000Z" },
];

function task(over: Partial<StatusTaskInput>): StatusTaskInput {
  return {
    id: "t",
    status: "Todo",
    startsAt: NOW, // dated by default → "scheduled"; override to null for unplanned
    dueAt: null,
    activityAt: NOW,
    ...over,
  };
}

function detailTask(over: Partial<BreakdownTaskInput>): BreakdownTaskInput {
  return {
    id: "t",
    title: "Task",
    status: "Todo",
    priority: "Normal",
    startsAt: NOW,
    dueAt: null,
    activityAt: NOW,
    ...over,
  };
}

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function compute(tasks: StatusTaskInput[], terms: TimelineTermSpan[] = []) {
  return computeProjectStatus({ projectStatus: "Active", tasks, terms }, NOW);
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

  it("still reports hasWork=false when there are terms but no tasks", () => {
    const facts = compute([], TERMS);
    expect(facts.hasWork).toBe(false);
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
  it("flags in-motion undated tasks but not Backlog or dated work", () => {
    const facts = compute([
      task({ status: "Todo", startsAt: null, dueAt: null }), // unscheduled
      task({ status: "InProgress", startsAt: null, dueAt: null }), // unscheduled
      task({ status: "InReview", startsAt: null, dueAt: null }), // unscheduled
      task({ status: "Backlog", startsAt: null, dueAt: null }), // parked — not flagged
      task({ status: "Todo", startsAt: NOW }), // dated → scheduled
      task({ status: "Done", startsAt: null, dueAt: null }), // closed
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

describe("computeProjectStatus — current sprint", () => {
  it("labels the current sprint off the term start with days left in the band", () => {
    const facts = compute([], TERMS);
    expect(facts.activeSprint?.label).toBe("Sprint 1"); // Sep 7 is week 1
    expect(facts.activeSprint?.daysRemaining).toBe(7); // Sep 7 12:00 → Sep 14 00:00, ceil
  });

  it("exposes the sprint's first-day start for the hover window", () => {
    const facts = compute([], TERMS);
    expect(facts.activeSprint?.startsAt).toBe("2026-09-07T00:00:00.000Z");
  });

  it("is null when today falls outside every term", () => {
    const before = new Date("2026-08-01T12:00:00.000Z");
    const facts = computeProjectStatus(
      { projectStatus: "Active", tasks: [], terms: TERMS },
      before,
    );
    expect(facts.activeSprint).toBeNull();
  });
});

describe("computeStatusBreakdown", () => {
  it("buckets tasks by status in display order, omitting empty buckets and Cancelled", () => {
    const b = computeStatusBreakdown(
      [
        detailTask({ status: "Done" }),
        detailTask({ status: "Done" }),
        detailTask({ status: "InProgress" }),
        detailTask({ status: "Todo" }),
        detailTask({ status: "Cancelled" }),
      ],
      NOW,
    );
    expect(b.byStatus).toEqual([
      { status: "Done", label: "Done", count: 2 },
      { status: "InProgress", label: "In progress", count: 1 },
      { status: "Todo", label: "To do", count: 1 },
    ]);
  });

  it("names overdue tasks most-overdue-first with days + priority, excluding closed", () => {
    const b = computeStatusBreakdown(
      [
        detailTask({ id: "1", title: "Old", status: "Todo", priority: "High", dueAt: daysAgo(10) }),
        detailTask({ id: "2", title: "Older", status: "InProgress", priority: "Urgent", dueAt: daysAgo(30) }),
        detailTask({ id: "3", title: "Shipped", status: "Done", priority: "High", dueAt: daysAgo(50) }),
      ],
      NOW,
    );
    expect(b.overdue.map((o) => o.title)).toEqual(["Older", "Old"]);
    expect(b.overdue[0]).toMatchObject({ priority: "Urgent", daysOver: 30 });
  });

  it("orders unscheduled highest-priority first and excludes parked Backlog", () => {
    const b = computeStatusBreakdown(
      [
        detailTask({ title: "low", status: "Todo", priority: "Low", startsAt: null, dueAt: null }),
        detailTask({ title: "urgent", status: "InProgress", priority: "Urgent", startsAt: null, dueAt: null }),
        detailTask({ title: "parked", status: "Backlog", priority: "Urgent", startsAt: null, dueAt: null }),
      ],
      NOW,
    );
    expect(b.unscheduled.map((u) => u.title)).toEqual(["urgent", "low"]);
  });

  it("lists longest-stalled InProgress tasks and in-review titles", () => {
    const b = computeStatusBreakdown(
      [
        detailTask({ title: "Stuck", status: "InProgress", activityAt: daysAgo(STALE_DAYS + 5) }),
        detailTask({ title: "Fresh", status: "InProgress", activityAt: daysAgo(2) }),
        detailTask({ title: "Reviewing", status: "InReview" }),
      ],
      NOW,
    );
    expect(b.stale.map((s) => s.title)).toEqual(["Stuck"]);
    expect(b.inReview).toEqual(["Reviewing"]);
  });

  it("caps each named list at BREAKDOWN_CAP", () => {
    const many = Array.from({ length: BREAKDOWN_CAP + 3 }, (_, i) =>
      detailTask({ id: String(i), title: `T${i}`, status: "Todo", dueAt: daysAgo(i + 1) }),
    );
    const b = computeStatusBreakdown(many, NOW);
    expect(b.overdue).toHaveLength(BREAKDOWN_CAP);
  });
});
