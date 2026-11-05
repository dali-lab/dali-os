import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  createMilestone,
  createPeriod,
  createTask,
  deleteMilestone,
  deletePeriod,
  getTermWeeks,
  loadBoard,
  moveTask,
  saveTermWeeks,
  updatePeriod,
} from "../taskboard.server";
import { makeUser } from "../../../../../integration/factories-misc";

const now = new Date("2026-11-04T15:00:00Z");

const period = (over: Partial<Parameters<typeof createPeriod>[0]> = {}) =>
  createPeriod({ name: "Fall 2026", shortName: "26F", kind: "Term", startDate: "2026-09-13", weekCount: 10, ...over });

async function setup() {
  const me = await makeUser();
  await prisma.adminMembership.create({ data: { userId: me.id } });
  const created = await period();
  if (!created.ok) throw new Error("period");
  return { me, periodId: created.value.id };
}

const taskInput = (periodId: string, over: Record<string, unknown> = {}) => ({
  title: "Draft", description: null, periodId, week: 3, weekday: 2,
  milestoneId: null, assigneeIds: [], status: "Backlog" as const, ...over,
});

describe("term length setting", () => {
  it("defaults to 10 and keeps a single shared row", async () => {
    expect(await getTermWeeks()).toBe(10);
    await saveTermWeeks(12);
    await saveTermWeeks(8);
    expect(await getTermWeeks()).toBe(8);
    expect(await prisma.educationTaskboardSettings.count()).toBe(1);
  });
});

describe("seeding periods from terms", () => {
  const term = (code: string, year: number, start: string, end: string, sortKey: number) =>
    prisma.term.create({
      data: { code, year, season: "F", sortKey, startDate: new Date(`${start}T00:00:00Z`), endDate: new Date(`${end}T00:00:00Z`) },
    });

  it("creates one aligned period per upcoming term and is idempotent", async () => {
    await term("26F", 2026, "2026-09-14", "2026-11-21", 20264);
    const first = await loadBoard(now);
    expect(first.periods).toHaveLength(1);
    expect(first.periods[0]).toMatchObject({ shortName: "26F", startDate: "2026-09-13", weekCount: 10, kind: "Term" });
    const second = await loadBoard(now);
    expect(second.periods).toHaveLength(1);
  });

  it("survives two requests seeding at the same time", async () => {
    await term("26F", 2026, "2026-09-14", "2026-11-21", 20264);
    await Promise.all([loadBoard(now), loadBoard(now), loadBoard(now)]);
    expect(await prisma.educationPeriod.count()).toBe(1);
  });

  it("skips terms that ended long ago", async () => {
    await term("20F", 2020, "2020-09-14", "2020-11-21", 20204);
    expect((await loadBoard(now)).periods).toHaveLength(0);
  });
});

describe("assignees", () => {
  it("only Core members can be assigned", async () => {
    const { periodId, me } = await setup();
    const outsider = await makeUser();
    const refused = await createTask(taskInput(periodId, { assigneeIds: [outsider.id] }), me.id);
    expect(refused).toMatchObject({ ok: false, status: 400 });
    expect(await prisma.educationTask.count()).toBe(0);
    const ok = await createTask(taskInput(periodId, { assigneeIds: [me.id] }), me.id);
    expect(ok.ok).toBe(true);
  });

  it("lists Core members for the picker and nobody else", async () => {
    const { me } = await setup();
    await makeUser();
    const board = await loadBoard(now);
    expect(board.members.map((m) => m.id)).toEqual([me.id]);
  });
});

describe("moving tasks", () => {
  it("pulls a backlog task into a week, assigns the actor, then stamps and clears completion", async () => {
    const { periodId, me } = await setup();
    const created = await createTask(taskInput(periodId), me.id);
    if (!created.ok) throw new Error("task");
    const id = created.value.id;

    await moveTask({ id, status: "Todo", periodId, week: 8, actorId: me.id, now });
    let row = await prisma.educationTask.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "Todo", week: 8, assigneeIds: [me.id], completedAt: null });

    await moveTask({ id, status: "Done", periodId, week: 8, actorId: me.id, now });
    row = await prisma.educationTask.findUniqueOrThrow({ where: { id } });
    expect(row.completedAt).toEqual(now);

    await moveTask({ id, status: "Doing", periodId, week: 8, actorId: me.id, now });
    row = await prisma.educationTask.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "Doing", completedAt: null });
  });

  it("refuses a week outside the period", async () => {
    const { periodId, me } = await setup();
    const created = await createTask(taskInput(periodId), me.id);
    if (!created.ok) throw new Error("task");
    const result = await moveTask({ id: created.value.id, status: "Todo", periodId, week: 11, actorId: me.id, now });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});

describe("milestones and periods", () => {
  it("deleting a milestone keeps its tasks as loose tasks", async () => {
    const { periodId, me } = await setup();
    const ms = await createMilestone({ name: "Launch", description: null, periodId, startWeek: 1, endWeek: 4 });
    if (!ms.ok) throw new Error("ms");
    const task = await createTask(taskInput(periodId, { milestoneId: ms.value.id }), me.id);
    if (!task.ok) throw new Error("task");
    await deleteMilestone(ms.value.id);
    const row = await prisma.educationTask.findUniqueOrThrow({ where: { id: task.value.id } });
    expect(row.milestoneId).toBeNull();
  });

  it("will not shrink a period below its tasks or milestones", async () => {
    const { periodId, me } = await setup();
    await createTask(taskInput(periodId, { week: 9 }), me.id);
    const input = { name: "Fall 2026", shortName: "26F", kind: "Term" as const, startDate: "2026-09-13", weekCount: 8 };
    expect(await updatePeriod(periodId, input)).toMatchObject({ ok: false, status: 409 });
    await prisma.educationTask.deleteMany();
    await createMilestone({ name: "Late", description: null, periodId, startWeek: 8, endWeek: 10 });
    expect(await updatePeriod(periodId, input)).toMatchObject({ ok: false, status: 409 });
    await prisma.educationMilestone.deleteMany();
    expect(await updatePeriod(periodId, input)).toEqual({ ok: true, value: undefined });
    expect((await prisma.educationPeriod.findUniqueOrThrow({ where: { id: periodId } })).weekCount).toBe(8);
  });

  it("keeps a two week interim", async () => {
    const created = await period({ name: "Break", shortName: "Int", kind: "Interim", startDate: "2026-11-22", weekCount: 2 });
    if (!created.ok) throw new Error("period");
    expect((await prisma.educationPeriod.findUniqueOrThrow({ where: { id: created.value.id } })).weekCount).toBe(2);
  });

  it("cannot delete a period that has tasks, and deleting an empty one removes its milestones", async () => {
    const { periodId, me } = await setup();
    await createMilestone({ name: "Launch", description: null, periodId, startWeek: 1, endWeek: 2 });
    const task = await createTask(taskInput(periodId), me.id);
    if (!task.ok) throw new Error("task");
    expect(await deletePeriod(periodId)).toMatchObject({ ok: false, status: 409 });
    await prisma.educationTask.delete({ where: { id: task.value.id } });
    expect(await deletePeriod(periodId)).toEqual({ ok: true, value: undefined });
    expect(await prisma.educationMilestone.count()).toBe(0);
  });
});
