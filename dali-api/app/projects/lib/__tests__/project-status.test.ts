import { describe, it, expect } from "vitest";
import {
  computeProjectStatus,
  factsFingerprint,
  STALE_DAYS,
  type StatusTaskInput,
  type StatusSprintInput,
} from "../project-status";

const NOW = new Date("2026-09-07T12:00:00.000Z");

function task(over: Partial<StatusTaskInput>): StatusTaskInput {
  return {
    status: "Todo",
    dueAt: null,
    sprintId: "sprint-1",
    activityAt: NOW,
    ...over,
  };
}

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
    const base = compute([task({ status: "Todo", dueAt: "2026-09-01" })]);
    const same = compute([task({ status: "Todo", dueAt: "2026-09-01" })]);
    const more = compute([
      task({ status: "Todo", dueAt: "2026-09-01" }),
      task({ status: "Todo", dueAt: "2026-09-02" }),
    ]);
    expect(factsFingerprint(base)).toBe(factsFingerprint(same));
    expect(factsFingerprint(base)).not.toBe(factsFingerprint(more));
  });
});
