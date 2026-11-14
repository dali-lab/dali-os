import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { getCoreBoardProject } from "~/projects/lib/core-board.server";

describe("Core board project", () => {
  it("allows only one CoreBoard project", async () => {
    await prisma.project.create({ data: { name: "Core", kind: "CoreBoard" } });
    await expect(prisma.project.create({ data: { name: "Core 2", kind: "CoreBoard" } })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("allows any number of Standard projects", async () => {
    await prisma.project.create({ data: { name: "A" } });
    await prisma.project.create({ data: { name: "B" } });
    expect(await prisma.project.count()).toBe(2);
  });

  it("getCoreBoardProject creates once and returns the same row, even concurrently", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => getCoreBoardProject()));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await prisma.project.count({ where: { kind: "CoreBoard" } })).toBe(1);
  });
});

describe("project list reads exclude the Core board", () => {
  async function seed() {
    const std = await prisma.project.create({ data: { name: "Standard one" } });
    const core = await prisma.project.create({ data: { name: "Core", kind: "CoreBoard" } });
    return { std, core };
  }

  it("findMany, findFirst, count and groupBy skip it", async () => {
    const { std } = await seed();
    expect((await prisma.project.findMany()).map((p) => p.id)).toEqual([std.id]);
    expect(await prisma.project.count()).toBe(1);
    expect((await prisma.project.findFirst({ where: { name: "Core" } }))).toBeNull();
    const groups = await prisma.project.groupBy({ by: ["status"], _count: { _all: true } });
    expect(groups.reduce((n, g) => n + g._count._all, 0)).toBe(1);
  });

  it("findUnique by id and an explicit kind filter still reach it", async () => {
    const { core } = await seed();
    expect((await prisma.project.findUnique({ where: { id: core.id } }))?.id).toBe(core.id);
    expect((await prisma.project.findMany({ where: { kind: "CoreBoard" } })).map((p) => p.id)).toEqual([core.id]);
  });
});
