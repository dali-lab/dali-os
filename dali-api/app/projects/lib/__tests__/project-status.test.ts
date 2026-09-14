import { describe, it, expect } from "vitest";
import {
  computeProjectStatus,
  factsFingerprint,
  buildTldrDetail,
  STALE_DAYS,
  type StatusTaskInput,
  type TldrTaskInput,
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

function detailTask(over: Partial<TldrTaskInput>): TldrTaskInput {
  return {
    id: "t",
    title: "Task",
    status: "Todo",
    priority: "Normal",
    startsAt: NOW,
    dueAt: null,
    activityAt: NOW,
    assigneeIds: [],
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

  it("is null when today falls outside every term", () => {
    const before = new Date("2026-08-01T12:00:00.000Z");
    const facts = computeProjectStatus(
      { projectStatus: "Active", tasks: [], terms: TERMS },
      before,
    );
    expect(facts.activeSprint).toBeNull();
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
        detailTask({ id: "1", status: "InProgress", priority: "Urgent", startsAt: null, dueAt: null, assigneeIds: ["u1", "u2"] }),
        detailTask({ id: "2", status: "Todo", priority: "High", startsAt: null, dueAt: null, assigneeIds: ["u2"] }),
        detailTask({ id: "3", status: "Todo", priority: "High", startsAt: NOW, assigneeIds: ["u3"] }), // dated
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
