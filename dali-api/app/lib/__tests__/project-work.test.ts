import { describe, it, expect } from "vitest";
import { projectWorkMeta } from "~/lib/project-work";

const now = new Date("2026-09-24T12:00:00.000Z");
const base = { status: "Todo" as const, dueAt: null, activityAt: "2026-09-23T12:00:00.000Z" };

describe("projectWorkMeta", () => {
  it("flags a passed deadline as overdue", () => {
    const m = projectWorkMeta({ ...base, dueAt: "2026-09-21T12:00:00.000Z" }, now);
    expect(m.kind).toBe("overdue");
    expect(m.warn).toBe(true);
    expect(m.text).toMatch(/^Overdue · was due /);
  });

  it("prefers overdue over review", () => {
    const m = projectWorkMeta(
      { ...base, status: "InReview", dueAt: "2026-09-21T12:00:00.000Z" },
      now,
    );
    expect(m.kind).toBe("overdue");
  });

  it("flags in-progress work untouched for the stale window", () => {
    const m = projectWorkMeta(
      { ...base, status: "InProgress", activityAt: "2026-09-01T12:00:00.000Z" },
      now,
    );
    expect(m).toMatchObject({ kind: "stale", warn: true, text: "No updates in 23 days" });
  });

  it("does not call a to-do stale", () => {
    const m = projectWorkMeta({ ...base, activityAt: "2026-09-01T12:00:00.000Z" }, now);
    expect(m.kind).toBe("none");
  });

  it("shows review, then an upcoming deadline, then no date", () => {
    expect(projectWorkMeta({ ...base, status: "InReview" }, now).kind).toBe("review");
    const due = projectWorkMeta({ ...base, dueAt: "2026-09-25T12:00:00.000Z" }, now);
    expect(due).toMatchObject({ kind: "due", warn: false });
    expect(due.text).toMatch(/^Due /);
    expect(projectWorkMeta(base, now)).toMatchObject({ kind: "none", text: "No due date" });
  });
});
