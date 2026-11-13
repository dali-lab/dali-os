import { describe, expect, it } from "vitest";
import {
  dateToRef, daysWithTasks, dueLabel, initialMonth, monthRows, monthTitle, refToDate, shiftMonth, weekLabel, weekLoad,
} from "../calendar";
import type { StoredTask } from "../taskboard.server";
import type { BoardPeriod } from "../weeks";

const periods: BoardPeriod[] = [
  { id: "f", name: "Fall 2026", shortName: "26F", kind: "Term", startDate: "2026-09-13", weekCount: 10 },
  { id: "i", name: "Interim", shortName: "Int", kind: "Interim", startDate: "2026-11-22", weekCount: 6 },
];
const task = (over: Partial<StoredTask> & { id: string }): StoredTask => ({
  title: over.id, description: null, periodId: "f", milestoneId: null, week: 8, weekday: 4,
  status: "Todo", assigneeIds: ["me"], completedAt: null, ...over,
});

describe("month grid", () => {
  it("lays November 2026 out in five rows starting on a Sunday", () => {
    const rows = monthRows(periods, 2026, 11);
    expect(rows).toHaveLength(5);
    expect(rows[0].cells[0]).toEqual({ ymd: "2026-11-01", day: 1 });
    expect(rows[4].cells.filter(Boolean).map((c) => c!.day)).toEqual([29, 30]);
    expect(rows[4].cells.slice(2).every((c) => c === null)).toBe(true);
  });

  it("pads the first row when the month starts mid week", () => {
    const rows = monthRows(periods, 2026, 12);
    expect(rows[0].cells.slice(0, 2)).toEqual([null, null]);
    expect(rows[0].cells[2]).toEqual({ ymd: "2026-12-01", day: 1 });
  });

  it("labels rows by term week and interim week", () => {
    const labels = monthRows(periods, 2026, 11).map((r) => r.label);
    expect(labels).toEqual(["Wk 8", "Wk 9", "Wk 10", "Int. 1", "Int. 2"]);
  });

  it("leaves rows outside every period unlabeled", () => {
    expect(monthRows(periods, 2027, 6)[0].label).toBe("");
  });

  it("handles a month that ends on a Saturday", () => {
    expect(monthRows(periods, 2026, 10).at(-1)!.cells[6]).toEqual({ ymd: "2026-10-31", day: 31 });
  });
});

describe("month navigation", () => {
  it("titles and shifts across year boundaries", () => {
    expect(monthTitle(2026, 11)).toBe("November 2026");
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2027, 1, -1)).toEqual({ year: 2026, month: 12 });
    expect(shiftMonth(2026, 3, -14)).toEqual({ year: 2025, month: 1 });
  });

  it("opens on the due date's month, else the fallback", () => {
    expect(initialMonth(periods, { periodId: "f", week: 8, weekday: 4 }, "2026-01-01")).toEqual({ year: 2026, month: 11 });
    expect(initialMonth(periods, null, "2027-02-10")).toEqual({ year: 2027, month: 2 });
  });
});

describe("date and week conversion", () => {
  it("derives period, week and weekday from a date", () => {
    expect(dateToRef(periods, "2026-11-05")).toEqual({ periodId: "f", week: 8, weekday: 4 });
    expect(dateToRef(periods, "2026-11-22")).toEqual({ periodId: "i", week: 1, weekday: 0 });
    expect(dateToRef(periods, "2030-01-01")).toBeNull();
  });

  it("round trips a ref to its date", () => {
    expect(refToDate(periods, { periodId: "f", week: 8, weekday: 4 })).toBe("2026-11-05");
    expect(refToDate(periods, { periodId: "gone", week: 1, weekday: 0 })).toBeNull();
  });

  it("words the due button", () => {
    expect(dueLabel(periods, { periodId: "f", week: 8, weekday: 4 })).toEqual({ main: "26F · Week 8", day: "Thu, Nov 5" });
    expect(dueLabel(periods, { periodId: "gone", week: 1, weekday: 0 })).toEqual({ main: "Pick a date", day: "" });
  });

  it("labels weeks of terms and interims", () => {
    expect(weekLabel(periods, "2026-09-13")).toBe("Wk 1");
    expect(weekLabel(periods, "2026-11-29")).toBe("Int. 2");
  });
});

describe("daysWithTasks", () => {
  it("marks days with non-backlog tasks only", () => {
    const days = daysWithTasks(
      [task({ id: "a" }), task({ id: "b", status: "Done", weekday: 1 }), task({ id: "c", status: "Backlog", weekday: 2 })],
      periods,
    );
    expect([...days].sort()).toEqual(["2026-11-02", "2026-11-05"]);
  });

  it("ignores tasks in unknown periods", () => {
    expect(daysWithTasks([task({ id: "a", periodId: "gone" })], periods).size).toBe(0);
  });
});

describe("weekLoad", () => {
  const members = [{ id: "me", name: "Joyce" }, { id: "ar", name: "Arthur" }];
  const ref = { periodId: "f", week: 8 };

  it("counts open tasks per assignee, ignoring done and other weeks", () => {
    const load = weekLoad(
      [
        task({ id: "1" }), task({ id: "2" }), task({ id: "3", status: "Done" }), task({ id: "4", week: 9 }),
        task({ id: "5", assigneeIds: ["ar"], status: "Backlog" }), task({ id: "6", assigneeIds: [] }),
      ],
      members, ref, null,
    );
    expect(load).toEqual([
      { userId: "me", name: "Joyce", count: 2, tone: "ok" },
      { userId: "ar", name: "Arthur", count: 1, tone: "ok" },
    ]);
  });

  it("turns busy at three tasks", () => {
    const load = weekLoad([task({ id: "1" }), task({ id: "2" }), task({ id: "3" })], members, ref, null);
    expect(load[0].tone).toBe("busy");
  });

  it("leaves out the task being edited", () => {
    const load = weekLoad([task({ id: "1" }), task({ id: "2" })], members, ref, "1");
    expect(load[0].count).toBe(1);
  });

  it("counts a shared task for each assignee", () => {
    const load = weekLoad([task({ id: "1", assigneeIds: ["me", "ar"] })], members, ref, null);
    expect(load.map((l) => l.count)).toEqual([1, 1]);
  });

  it("names unknown assignees generically", () => {
    expect(weekLoad([task({ id: "1", assigneeIds: ["x"] })], members, ref, null)[0].name).toBe("Someone");
  });
});
