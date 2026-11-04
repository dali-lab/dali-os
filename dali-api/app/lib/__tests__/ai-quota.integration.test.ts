import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../integration/db";
import { AI_DAILY_MAX, claimAiQuota } from "../ai-quota.server";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const count = async (userId: string, day: string) =>
  (await prisma.aiUsage.findUnique({ where: { userId_day: { userId, day } } }))?.count;

describe("claimAiQuota against the database", () => {
  it("loses no updates across 25 concurrent claims", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => claimAiQuota("u1")));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await count("u1", "2026-11-04")).toBe(25);
  });

  it("lets exactly the daily max through a burst across the limit", async () => {
    const extra = 10;
    const results = await Promise.all(Array.from({ length: AI_DAILY_MAX + extra }, () => claimAiQuota("u1")));
    expect(results.filter((r) => r.ok)).toHaveLength(AI_DAILY_MAX);
    const refused = results.filter((r) => !r.ok);
    expect(refused).toHaveLength(extra);
    expect(refused[0]).toMatchObject({ retryAfterSeconds: 12 * 3600 });
    expect(await count("u1", "2026-11-04")).toBe(AI_DAILY_MAX + extra);
  });

  it("starts fresh on a new UTC day", async () => {
    await Promise.all(Array.from({ length: AI_DAILY_MAX + 1 }, () => claimAiQuota("u1")));
    expect(await claimAiQuota("u1")).toMatchObject({ ok: false });
    vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
    expect(await claimAiQuota("u1")).toEqual({ ok: true, day: "2026-11-05" });
    expect(await count("u1", "2026-11-05")).toBe(1);
  });

  it("counts each user separately", async () => {
    await Promise.all(Array.from({ length: AI_DAILY_MAX + 1 }, () => claimAiQuota("u1")));
    expect(await claimAiQuota("u2")).toEqual({ ok: true, day: "2026-11-04" });
    expect(await count("u2", "2026-11-04")).toBe(1);
  });
});
