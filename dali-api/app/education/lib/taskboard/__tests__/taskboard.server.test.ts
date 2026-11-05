import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => {
  const model = () => ({
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  });
  return {
    prisma: {
      term: model(),
      user: model(),
      adminMembership: model(),
      coreAssignment: model(),
      educationPeriod: model(),
      educationMilestone: model(),
      educationTask: model(),
      educationTaskboardSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    },
  };
});
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  getActiveCoreCycleTermIds: vi.fn(),
  getAdminUserIdsFromEnv: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { getActiveCoreCycleTermIds, getAdminUserIdsFromEnv, isCore } from "~/lib/roles";
import {
  coreMemberIds,
  createMilestone,
  createPeriod,
  createTask,
  deleteMilestone,
  deletePeriod,
  deleteTask,
  listCoreMembers,
  loadBoard,
  moveTask,
  getTermWeeks,
  periodWeekCounts,
  saveTermWeeks,
  seedPeriodsFromTerms,
  updateMilestone,
  updatePeriod,
  updateTask,
} from "../taskboard.server";

const m = prisma as any;
const now = new Date("2026-11-04T15:00:00Z");

const taskInput = {
  title: "Draft", description: null, periodId: "p", week: 3, weekday: 2,
  milestoneId: null, assigneeIds: [], status: "Backlog" as const,
};
const periodInput = {
  name: "Interim", shortName: "Int", kind: "Interim" as const, startDate: "2026-11-22", weekCount: 6,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAdminUserIdsFromEnv).mockReturnValue([]);
  vi.mocked(getActiveCoreCycleTermIds).mockResolvedValue([]);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("seedPeriodsFromTerms", () => {
  it("creates one aligned period per unseeded term", async () => {
    m.term.findMany.mockResolvedValue([
      {
        id: "t1", code: "26F", year: 2026, season: "F",
        startDate: new Date("2026-09-14T00:00:00Z"), endDate: new Date("2026-11-21T00:00:00Z"),
      },
    ]);
    await seedPeriodsFromTerms(now);
    expect(m.educationPeriod.createMany).toHaveBeenCalledWith({
      data: [
        {
          name: "Fall 2026", shortName: "26F", kind: "Term",
          startDate: new Date("2026-09-13T00:00:00Z"), weekCount: 10, termId: "t1",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("only considers terms without a period", async () => {
    m.term.findMany.mockResolvedValue([]);
    await seedPeriodsFromTerms(now);
    expect(m.term.findMany.mock.calls[0][0].where.educationPeriod).toBeNull();
    expect(m.educationPeriod.createMany).not.toHaveBeenCalled();
  });
});

describe("core members", () => {
  it("unions env admins, admin memberships and active core assignments", async () => {
    vi.mocked(getAdminUserIdsFromEnv).mockReturnValue(["env"]);
    m.adminMembership.findMany.mockResolvedValue([{ userId: "admin" }, { userId: "env" }]);
    vi.mocked(getActiveCoreCycleTermIds).mockResolvedValue(["t"]);
    m.coreAssignment.findMany.mockResolvedValue([{ userId: "core" }]);
    expect((await coreMemberIds()).sort()).toEqual(["admin", "core", "env"]);
    expect(m.coreAssignment.findMany.mock.calls[0][0].where).toEqual({ termId: { in: ["t"] } });
  });

  it("skips core assignments when no cycle is active", async () => {
    m.adminMembership.findMany.mockResolvedValue([]);
    await coreMemberIds();
    expect(m.coreAssignment.findMany).not.toHaveBeenCalled();
  });

  it("lists only those users, never the whole table", async () => {
    m.adminMembership.findMany.mockResolvedValue([{ userId: "a" }]);
    m.user.findMany.mockResolvedValue([{ id: "a", firstName: "Ada", lastName: "Lovelace", photoUrl: null }]);
    expect(await listCoreMembers()).toEqual([{ id: "a", name: "Ada Lovelace", photoUrl: null }]);
    expect(m.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["a"] } });
  });

  it("returns nothing and skips the user query with no core members", async () => {
    m.adminMembership.findMany.mockResolvedValue([]);
    expect(await listCoreMembers()).toEqual([]);
    expect(m.user.findMany).not.toHaveBeenCalled();
  });
});

describe("loadBoard", () => {
  it("serializes periods to date-only strings", async () => {
    m.term.findMany.mockResolvedValue([]);
    m.educationPeriod.findMany.mockResolvedValue([
      { id: "p", name: "Fall", shortName: "26F", kind: "Term", startDate: new Date("2026-09-13T00:00:00Z"), weekCount: 10 },
    ]);
    m.educationMilestone.findMany.mockResolvedValue([]);
    m.educationTask.findMany.mockResolvedValue([
      { id: "t", title: "T", description: null, periodId: "p", milestoneId: null, week: 1, weekday: 0, status: "Todo", assigneeIds: [], completedAt: new Date("2026-11-02T10:00:00Z") },
    ]);
    m.adminMembership.findMany.mockResolvedValue([]);
    m.educationTaskboardSettings.findUnique.mockResolvedValue({ termWeeks: 12 });
    const board = await loadBoard(now);
    expect(board.termWeeks).toBe(12);
    expect(board.periods[0].startDate).toBe("2026-09-13");
    expect(board.tasks[0].status).toBe("Todo");
    expect(board.tasks[0].completedAt).toBe("2026-11-02T10:00:00.000Z");
    expect(board.members).toEqual([]);
  });
});

describe("periodWeekCounts", () => {
  it("maps ids to week counts", async () => {
    m.educationPeriod.findMany.mockResolvedValue([{ id: "p", weekCount: 10 }]);
    expect((await periodWeekCounts()).get("p")).toBe(10);
  });
});

describe("createTask", () => {
  it("appends after the last position and stamps the creator", async () => {
    m.educationTask.aggregate.mockResolvedValue({ _max: { position: 4 } });
    m.educationTask.create.mockResolvedValue({ id: "new" });
    const r = await createTask(taskInput, "me");
    expect(r).toEqual({ ok: true, value: { id: "new" } });
    expect(m.educationTask.create.mock.calls[0][0].data).toMatchObject({
      createdById: "me", position: 5, completedAt: null, status: "Backlog",
    });
  });

  it("stamps completedAt when created as done", async () => {
    m.educationTask.aggregate.mockResolvedValue({ _max: { position: null } });
    m.educationTask.create.mockResolvedValue({ id: "n" });
    await createTask({ ...taskInput, status: "Done" }, "me");
    expect(m.educationTask.create.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
    expect(m.educationTask.create.mock.calls[0][0].data.position).toBe(1);
  });

  it("rejects a missing milestone without writing", async () => {
    m.educationMilestone.findUnique.mockResolvedValue(null);
    const r = await createTask({ ...taskInput, milestoneId: "gone" }, "me");
    expect(r).toEqual({ ok: false, status: 400, error: "That milestone no longer exists." });
    expect(m.educationTask.create).not.toHaveBeenCalled();
  });

  it("rejects assigning to someone who is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const r = await createTask({ ...taskInput, assigneeIds: ["outsider"] }, "me");
    expect(r).toEqual({ ok: false, status: 400, error: "Tasks can only be assigned to Core members." });
    expect(m.educationTask.create).not.toHaveBeenCalled();
  });
});

describe("updateTask", () => {
  it("404s for a missing task", async () => {
    m.educationTask.findUnique.mockResolvedValue(null);
    expect(await updateTask("x", taskInput)).toMatchObject({ ok: false, status: 404 });
  });

  it("keeps the original completedAt when it stays done", async () => {
    const done = new Date("2026-10-01T00:00:00Z");
    m.educationTask.findUnique.mockResolvedValue({ status: "Done", completedAt: done });
    await updateTask("x", { ...taskInput, status: "Done" });
    expect(m.educationTask.update.mock.calls[0][0].data.completedAt).toEqual(done);
  });

  it("stamps on first completion and clears on reopen", async () => {
    m.educationTask.findUnique.mockResolvedValue({ status: "Doing", completedAt: null });
    await updateTask("x", { ...taskInput, status: "Done" });
    expect(m.educationTask.update.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
    m.educationTask.findUnique.mockResolvedValue({ status: "Done", completedAt: new Date() });
    await updateTask("x", { ...taskInput, status: "Todo" });
    expect(m.educationTask.update.mock.calls[1][0].data.completedAt).toBeNull();
  });

  it("rejects non-Core assignees", async () => {
    m.educationTask.findUnique.mockResolvedValue({ status: "Todo", completedAt: null });
    vi.mocked(isCore).mockResolvedValue(false);
    expect(await updateTask("x", { ...taskInput, assigneeIds: ["o"] })).toMatchObject({ ok: false, status: 400 });
    expect(m.educationTask.update).not.toHaveBeenCalled();
  });
});

describe("deleteTask", () => {
  it("deletes or 404s", async () => {
    m.educationTask.deleteMany.mockResolvedValueOnce({ count: 1 });
    expect(await deleteTask("a")).toEqual({ ok: true, value: undefined });
    m.educationTask.deleteMany.mockResolvedValueOnce({ count: 0 });
    expect(await deleteTask("a")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("moveTask", () => {
  const args = { id: "t", status: "Todo" as const, periodId: "p", week: 8, actorId: "me", now };

  it("404s for a missing task", async () => {
    m.educationTask.findUnique.mockResolvedValue(null);
    expect(await moveTask(args)).toMatchObject({ ok: false, status: 404 });
  });

  it("rejects weeks outside the period", async () => {
    m.educationTask.findUnique.mockResolvedValue({ assigneeIds: [], status: "Backlog" });
    m.educationPeriod.findUnique.mockResolvedValue({ weekCount: 10 });
    expect(await moveTask({ ...args, week: 11 })).toMatchObject({ ok: false, status: 400 });
    expect(await moveTask({ ...args, week: 0 })).toMatchObject({ ok: false, status: 400 });
    m.educationPeriod.findUnique.mockResolvedValue(null);
    expect(await moveTask(args)).toMatchObject({ ok: false, status: 400 });
    expect(m.educationTask.update).not.toHaveBeenCalled();
  });

  it("writes the move patch with the actor as default assignee", async () => {
    m.educationTask.findUnique.mockResolvedValue({ assigneeIds: [], status: "Backlog" });
    m.educationPeriod.findUnique.mockResolvedValue({ weekCount: 10 });
    expect(await moveTask(args)).toEqual({ ok: true, value: undefined });
    expect(m.educationTask.update).toHaveBeenCalledWith({
      where: { id: "t" },
      data: { status: "Todo", periodId: "p", week: 8, assigneeIds: ["me"], completedAt: null },
    });
  });
});

describe("milestones", () => {
  const input = { name: "Launch", description: null, periodId: "p", startWeek: 1, endWeek: 3 };

  it("creates and returns the id", async () => {
    m.educationMilestone.create.mockResolvedValue({ id: "m" });
    expect(await createMilestone(input)).toEqual({ ok: true, value: { id: "m" } });
  });

  it("updates or 404s", async () => {
    m.educationMilestone.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await updateMilestone("m", input)).toEqual({ ok: true, value: undefined });
    m.educationMilestone.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await updateMilestone("m", input)).toMatchObject({ ok: false, status: 404 });
  });

  it("deletes or 404s", async () => {
    m.educationMilestone.deleteMany.mockResolvedValueOnce({ count: 1 });
    expect(await deleteMilestone("m")).toEqual({ ok: true, value: undefined });
    m.educationMilestone.deleteMany.mockResolvedValueOnce({ count: 0 });
    expect(await deleteMilestone("m")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("periods", () => {
  it("creates with a UTC midnight start", async () => {
    m.educationPeriod.create.mockResolvedValue({ id: "p" });
    await createPeriod(periodInput);
    expect(m.educationPeriod.create.mock.calls[0][0].data.startDate).toEqual(new Date("2026-11-22T00:00:00Z"));
  });

  it("blocks shrinking past existing tasks or milestones", async () => {
    m.educationTask.count.mockResolvedValue(1);
    m.educationMilestone.count.mockResolvedValue(0);
    expect(await updatePeriod("p", periodInput)).toMatchObject({ ok: false, status: 409 });
    m.educationTask.count.mockResolvedValue(0);
    m.educationMilestone.count.mockResolvedValue(2);
    expect(await updatePeriod("p", periodInput)).toMatchObject({ ok: false, status: 409 });
    expect(m.educationPeriod.updateMany).not.toHaveBeenCalled();
  });

  it("updates when nothing is cut off, or 404s", async () => {
    m.educationTask.count.mockResolvedValue(0);
    m.educationMilestone.count.mockResolvedValue(0);
    m.educationPeriod.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await updatePeriod("p", periodInput)).toEqual({ ok: true, value: undefined });
    m.educationPeriod.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await updatePeriod("p", periodInput)).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses to delete a period that still has tasks", async () => {
    m.educationTask.count.mockResolvedValue(3);
    expect(await deletePeriod("p")).toMatchObject({ ok: false, status: 409 });
    expect(m.educationPeriod.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes an empty period, or 404s", async () => {
    m.educationTask.count.mockResolvedValue(0);
    m.educationPeriod.deleteMany.mockResolvedValueOnce({ count: 1 });
    expect(await deletePeriod("p")).toEqual({ ok: true, value: undefined });
    m.educationPeriod.deleteMany.mockResolvedValueOnce({ count: 0 });
    expect(await deletePeriod("p")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("term length setting", () => {
  it("defaults to 10 weeks when nothing is saved", async () => {
    m.educationTaskboardSettings.findUnique.mockResolvedValue(null);
    expect(await getTermWeeks()).toBe(10);
  });

  it("returns the saved value", async () => {
    m.educationTaskboardSettings.findUnique.mockResolvedValue({ termWeeks: 8 });
    expect(await getTermWeeks()).toBe(8);
  });

  it("saves one shared row", async () => {
    expect(await saveTermWeeks(12)).toEqual({ ok: true, value: undefined });
    expect(m.educationTaskboardSettings.upsert).toHaveBeenCalledWith({
      where: { id: "default" },
      create: { id: "default", termWeeks: 12 },
      update: { termWeeks: 12 },
    });
  });
});
