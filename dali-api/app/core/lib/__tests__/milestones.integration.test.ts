import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { createMilestone, moveMilestone, deleteMilestone } from "~/core/lib/milestones.server";

const actor = { userId: "nobody" };
let termId: string;

beforeEach(async () => {
  const term = await prisma.term.create({
    data: {
      code: "26F",
      year: 2026,
      season: "F",
      sortKey: 20264,
      startDate: new Date("2026-09-21T00:00:00Z"),
      endDate: new Date("2026-11-30T00:00:00Z"),
    },
  });
  termId = term.id;
});

const titles = async (week: number, kind: "Milestone" | "Plan" = "Milestone") =>
  (await prisma.coreMilestone.findMany({ where: { termId, week, kind }, orderBy: { position: "asc" } })).map(
    (r) => `${r.title}:${r.position}`,
  );

describe("CoreMilestone week check constraint", () => {
  it("accepts weeks 0 and 10", async () => {
    await prisma.coreMilestone.create({ data: { termId, week: 0, title: "lead-up" } });
    await prisma.coreMilestone.create({ data: { termId, week: 10, title: "last" } });
    expect(await prisma.coreMilestone.count()).toBe(2);
  });

  it("rejects weeks below 0 and above 10", async () => {
    await expect(prisma.coreMilestone.create({ data: { termId, week: 11, title: "late" } })).rejects.toThrow();
    await expect(prisma.coreMilestone.create({ data: { termId, week: -1, title: "early" } })).rejects.toThrow();
    expect(await prisma.coreMilestone.count()).toBe(0);
  });
});

describe("milestone positions", () => {
  it("appends in order per week and kind", async () => {
    await createMilestone({ termId, week: 3, title: "a" }, actor);
    await createMilestone({ termId, week: 3, title: "b" }, actor);
    await createMilestone({ termId, week: 3, kind: "Plan", title: "p" }, actor);
    expect(await titles(3)).toEqual(["a:0", "b:1"]);
    expect(await titles(3, "Plan")).toEqual(["p:0"]);
  });

  it("renumbers both weeks in one cross-week move", async () => {
    const a = await createMilestone({ termId, week: 2, title: "a" }, actor);
    await createMilestone({ termId, week: 2, title: "b" }, actor);
    await createMilestone({ termId, week: 2, title: "c" }, actor);
    await createMilestone({ termId, week: 6, title: "x" }, actor);
    await moveMilestone({ id: a.id, toWeek: 6 }, actor);
    expect(await titles(2)).toEqual(["b:0", "c:1"]);
    expect(await titles(6)).toEqual(["x:0", "a:1"]);
  });

  it("reorders within a week and closes the gap on delete", async () => {
    await createMilestone({ termId, week: 4, title: "a" }, actor);
    await createMilestone({ termId, week: 4, title: "b" }, actor);
    const c = await createMilestone({ termId, week: 4, title: "c" }, actor);
    await moveMilestone({ id: c.id, toWeek: 4, toPosition: 0 }, actor);
    expect(await titles(4)).toEqual(["c:0", "a:1", "b:2"]);
    await deleteMilestone(c.id, actor);
    expect(await titles(4)).toEqual(["a:0", "b:1"]);
  });

  it("removes a term's items when the term is deleted", async () => {
    await createMilestone({ termId, week: 1, title: "a" }, actor);
    await prisma.term.delete({ where: { id: termId } });
    expect(await prisma.coreMilestone.count()).toBe(0);
  });
});
