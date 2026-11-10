import { describe, expect, it, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { claimAiQuota } from "~/lib/ai-quota.server";

async function user() {
  return prisma.user.create({ data: { firstName: "Ada", lastName: "Lovelace" } });
}

describe("recordTokenUsage (real database)", () => {
  it("concurrent token increments sum exactly without touching the request count", async () => {
    const u = await user();
    const claim = await claimAiQuota(u.id);
    if (!claim.ok) throw new Error("quota unexpectedly exhausted");

    await Promise.all(Array.from({ length: 20 }, () => recordTokenUsage(u.id, claim.day, 10, 3)));

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
