import { describe, expect, it, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";

// The daily-quota upsert is inlined in each AI route (api.ai.doc, api.ai.email,
// api.ai.project-tldr, meeting-notes-enhance) with the same shape; this is that statement.
const AI_DAILY_MAX = 200;
const claim = (userId: string, day: string) =>
  prisma.aiUsage.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, count: 1 },
    update: { count: { increment: 1 } },
  });

async function user() {
  return prisma.user.create({ data: { firstName: "Ada", lastName: "Lovelace" } });
}

describe("AiUsage daily quota (real database)", () => {
  it("concurrent claims for one user and day are counted exactly, with each caller seeing a distinct count", async () => {
    const u = await user();

    const rows = await Promise.all(Array.from({ length: 25 }, () => claim(u.id, "2026-11-03")));

    expect(rows.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    const stored = await prisma.aiUsage.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].count).toBe(25);
  });

  it("the limit is enforced at the boundary: request 200 passes, 201 is over", async () => {
    const u = await user();
    await prisma.aiUsage.create({ data: { userId: u.id, day: "2026-11-03", count: AI_DAILY_MAX - 1 } });

    const atLimit = await claim(u.id, "2026-11-03");
    const over = await claim(u.id, "2026-11-03");

    expect(atLimit.count > AI_DAILY_MAX).toBe(false);
    expect(over.count > AI_DAILY_MAX).toBe(true);
  });

  it("a concurrent burst across the boundary lets exactly the remaining requests through", async () => {
    const u = await user();
    await prisma.aiUsage.create({ data: { userId: u.id, day: "2026-11-03", count: AI_DAILY_MAX - 3 } });

    const rows = await Promise.all(Array.from({ length: 10 }, () => claim(u.id, "2026-11-03")));

    expect(rows.filter((r) => r.count <= AI_DAILY_MAX)).toHaveLength(3);
    expect(rows.filter((r) => r.count > AI_DAILY_MAX)).toHaveLength(7);
  });

  it("a new day and a different user each start a fresh row at 1", async () => {
    const ada = await user();
    const alan = await prisma.user.create({ data: { firstName: "Alan", lastName: "Turing" } });
    await prisma.aiUsage.create({ data: { userId: ada.id, day: "2026-11-03", count: AI_DAILY_MAX } });

    const nextDay = await claim(ada.id, "2026-11-04");
    const other = await claim(alan.id, "2026-11-03");

    expect(nextDay.count).toBe(1);
    expect(other.count).toBe(1);
    expect(await prisma.aiUsage.count()).toBe(3);
  });

  it("the unique index rejects a duplicate user/day row", async () => {
    const u = await user();
    await prisma.aiUsage.create({ data: { userId: u.id, day: "2026-11-03" } });

    await expect(prisma.aiUsage.create({ data: { userId: u.id, day: "2026-11-03" } })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("recordTokenUsage (real database)", () => {
  it("concurrent token increments sum exactly without touching the request count", async () => {
    const u = await user();
    await claim(u.id, "2026-11-03");

    await Promise.all(Array.from({ length: 20 }, () => recordTokenUsage(u.id, "2026-11-03", 10, 3)));

    const row = await prisma.aiUsage.findFirstOrThrow();
    expect(row).toMatchObject({ count: 1, inputTokens: 200, outputTokens: 60 });
  });

  it("ignores zero usage and a missing row without throwing", async () => {
    const u = await user();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(recordTokenUsage(u.id, "2026-11-03", 0, 0)).resolves.toBeUndefined();
    await expect(recordTokenUsage(u.id, "2026-11-03", 5, 5)).resolves.toBeUndefined();

    expect(await prisma.aiUsage.count()).toBe(0);
  });
});
