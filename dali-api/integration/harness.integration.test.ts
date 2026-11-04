import { describe, expect, it } from "vitest";
import { prisma } from "./db";

describe("integration harness", () => {
  it("writes through the real client", async () => {
    await prisma.term.create({
      data: { code: "26X", year: 2026, season: "X", sortKey: 20263, startDate: new Date("2026-06-20"), endDate: new Date("2026-08-30") },
    });
    expect(await prisma.term.count()).toBe(1);
  });

  it("starts every test from an empty database", async () => {
    expect(await prisma.term.count()).toBe(0);
  });

  it("enforces real constraints that a mock would accept", async () => {
    const data = { code: "26X", year: 2026, season: "X" as const, sortKey: 20263, startDate: new Date("2026-06-20"), endDate: new Date("2026-08-30") };
    await prisma.term.create({ data });
    await expect(prisma.term.create({ data })).rejects.toMatchObject({ code: "P2002" });
  });
});
