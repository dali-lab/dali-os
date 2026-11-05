import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../taskboard.server", () => ({
  createMilestone: vi.fn(),
  createPeriod: vi.fn(),
  createTask: vi.fn(),
  deleteMilestone: vi.fn(),
  deletePeriod: vi.fn(),
  deleteTask: vi.fn(),
  moveTask: vi.fn(),
  periodWeekCounts: vi.fn(),
  saveTermWeeks: vi.fn(),
  updateMilestone: vi.fn(),
  updatePeriod: vi.fn(),
  updateTask: vi.fn(),
}));

import * as s from "../taskboard.server";
import { handleTaskboardAction, resultId } from "../actions.server";

const ok = { ok: true as const, value: undefined };
const now = new Date("2026-11-04T15:00:00Z");
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const run = (o: Record<string, string>) => handleTaskboardAction(form(o), "me", now);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(s.periodWeekCounts).mockResolvedValue(new Map([["p", 10]]));
  for (const fn of Object.values(s)) (fn as ReturnType<typeof vi.fn>).mockResolvedValue?.(ok);
  vi.mocked(s.periodWeekCounts).mockResolvedValue(new Map([["p", 10]]));
});

const task = { intent: "task-save", title: "Draft", periodId: "p", week: "2", weekday: "1" };

describe("task intents", () => {
  it("creates when there is no id, with the actor", async () => {
    await run(task);
    expect(s.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft", week: 2 }), "me");
    expect(s.updateTask).not.toHaveBeenCalled();
  });

  it("updates when an id is given", async () => {
    await run({ ...task, id: "t1" });
    expect(s.updateTask).toHaveBeenCalledWith("t1", expect.objectContaining({ title: "Draft" }));
    expect(s.createTask).not.toHaveBeenCalled();
  });

  it("rejects invalid input before touching the database", async () => {
    expect(await run({ ...task, title: "" })).toEqual({ ok: false, status: 400, error: "Add a title." });
    expect(await run({ ...task, week: "11" })).toMatchObject({ ok: false, status: 400 });
    expect(s.createTask).not.toHaveBeenCalled();
  });

  it("deletes by id", async () => {
    await run({ intent: "task-delete", id: "t1" });
    expect(s.deleteTask).toHaveBeenCalledWith("t1");
  });

  it("moves with status, week and period", async () => {
    await run({ intent: "task-move", id: "t1", status: "Doing", periodId: "p", week: "8" });
    expect(s.moveTask).toHaveBeenCalledWith({
      id: "t1", status: "Doing", periodId: "p", week: 8, actorId: "me", now,
    });
  });

  it("rejects a bad move status or week", async () => {
    expect(await run({ intent: "task-move", id: "t", status: "Nope", periodId: "p", week: "1" })).toMatchObject({ status: 400 });
    expect(await run({ intent: "task-move", id: "t", status: "Todo", periodId: "p", week: "x" })).toMatchObject({ status: 400 });
    expect(s.moveTask).not.toHaveBeenCalled();
  });
});

describe("milestone intents", () => {
  const ms = { intent: "milestone-save", name: "Launch", periodId: "p", startWeek: "1", endWeek: "4" };

  it("creates or updates by id", async () => {
    await run(ms);
    expect(s.createMilestone).toHaveBeenCalled();
    await run({ ...ms, id: "m1" });
    expect(s.updateMilestone).toHaveBeenCalledWith("m1", expect.objectContaining({ name: "Launch" }));
  });

  it("rejects a span outside the period", async () => {
    expect(await run({ ...ms, endWeek: "12" })).toMatchObject({ ok: false, status: 400 });
    expect(s.createMilestone).not.toHaveBeenCalled();
  });

  it("deletes by id", async () => {
    await run({ intent: "milestone-delete", id: "m1" });
    expect(s.deleteMilestone).toHaveBeenCalledWith("m1");
  });
});

describe("period intents", () => {
  const pd = { intent: "period-save", name: "Interim", kind: "Interim", startDate: "2026-11-22", weekCount: "6" };

  it("creates or updates by id", async () => {
    await run(pd);
    expect(s.createPeriod).toHaveBeenCalled();
    await run({ ...pd, id: "p1" });
    expect(s.updatePeriod).toHaveBeenCalledWith("p1", expect.objectContaining({ weekCount: 6 }));
  });

  it("rejects a non-Sunday start", async () => {
    expect(await run({ ...pd, startDate: "2026-11-23" })).toMatchObject({ ok: false, status: 400 });
    expect(s.createPeriod).not.toHaveBeenCalled();
  });

  it("deletes by id", async () => {
    await run({ intent: "period-delete", id: "p1" });
    expect(s.deletePeriod).toHaveBeenCalledWith("p1");
  });
});

describe("settings intent", () => {
  it("saves the clamped default term length", async () => {
    await run({ intent: "settings-save", termWeeks: "20" });
    expect(s.saveTermWeeks).toHaveBeenCalledWith(14);
  });

  it("rejects a missing length without saving", async () => {
    expect(await run({ intent: "settings-save" })).toMatchObject({ ok: false, status: 400 });
    expect(s.saveTermWeeks).not.toHaveBeenCalled();
  });
});

describe("unknown intents", () => {
  it("are rejected", async () => {
    expect(await run({ intent: "drop-table" })).toEqual({ ok: false, status: 400, error: "Unknown action." });
    expect(await run({})).toMatchObject({ ok: false, status: 400 });
  });
});

describe("resultId", () => {
  it("returns the created id, if any", () => {
    expect(resultId({ ok: true, value: { id: "abc" } })).toBe("abc");
    expect(resultId({ ok: true, value: undefined })).toBeUndefined();
    expect(resultId({ ok: true, value: { id: 5 } })).toBeUndefined();
    expect(resultId({ ok: false, status: 400, error: "x" })).toBeUndefined();
  });
});
