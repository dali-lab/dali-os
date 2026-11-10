import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import {
  AI_DAILY_MAX,
  ASK_DAILY_MAX,
  aiQuotaResponse,
  claimAiQuota,
  claimAskQuota,
  releaseAskQuota,
  secondsToUtcMidnight,
} from "../ai-quota.server";

const MESSAGE = "You've reached today's AI limit (200 requests). It resets at midnight UTC.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
  vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 1 } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("secondsToUtcMidnight", () => {
  it("counts down to the next UTC midnight", () => {
    expect(secondsToUtcMidnight(new Date("2026-11-04T12:00:00Z"))).toBe(12 * 3600);
  });

  it("is a full day just after midnight", () => {
    expect(secondsToUtcMidnight(new Date("2026-11-04T00:00:00Z"))).toBe(86_400);
    expect(secondsToUtcMidnight(new Date("2026-11-04T00:00:01Z"))).toBe(86_399);
  });

  it("rounds up and never drops below 1 just before midnight", () => {
    expect(secondsToUtcMidnight(new Date("2026-11-04T23:59:59Z"))).toBe(1);
    expect(secondsToUtcMidnight(new Date("2026-11-04T23:59:59.999Z"))).toBe(1);
  });

  it("rolls over month and year ends", () => {
    expect(secondsToUtcMidnight(new Date("2026-12-31T23:00:00Z"))).toBe(3600);
  });

  it("defaults to the current time", () => {
    expect(secondsToUtcMidnight()).toBe(12 * 3600);
  });
});

describe("claimAiQuota", () => {
  it("creates the day's row at count 1 and increments afterwards, keyed by UTC day", async () => {
    vi.setSystemTime(new Date("2026-11-04T23:30:00-05:00"));
    await claimAiQuota("u1");
    expect(prisma.aiUsage.upsert).toHaveBeenCalledWith({
      where: { userId_day: { userId: "u1", day: "2026-11-05" } },
      create: { userId: "u1", day: "2026-11-05", count: 1 },
      update: { count: { increment: 1 } },
    });
  });

  it("allows up to the daily max", async () => {
    vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: AI_DAILY_MAX } as never);
    expect(await claimAiQuota("u1")).toEqual({ ok: true, day: "2026-11-04", used: AI_DAILY_MAX });
  });

  it("refuses past the max with the message and seconds to midnight", async () => {
    vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: AI_DAILY_MAX + 1 } as never);
    expect(await claimAiQuota("u1")).toEqual({ ok: false, error: MESSAGE, retryAfterSeconds: 12 * 3600 });
  });

  it("caps at 200", () => {
    expect(AI_DAILY_MAX).toBe(200);
  });
});

describe("claimAskQuota", () => {
  it("counts on its own column, leaving the assistant's count alone", async () => {
    await claimAskQuota("u1");
    expect(prisma.aiUsage.upsert).toHaveBeenCalledWith({
      where: { userId_day: { userId: "u1", day: "2026-11-04" } },
      create: { userId: "u1", day: "2026-11-04", askCount: 1 },
      update: { askCount: { increment: 1 } },
    });
  });

  it("allows up to 50 questions a day", async () => {
    expect(ASK_DAILY_MAX).toBe(50);
    vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 0, askCount: 50 } as never);
    expect(await claimAskQuota("u1")).toEqual({ ok: true, day: "2026-11-04", used: 50 });
  });

  it("refuses the 51st question even when the assistant count is low", async () => {
    vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 0, askCount: 51 } as never);
    expect(await claimAskQuota("u1")).toEqual({
      ok: false,
      error: "You've used today's questions. They reset at midnight UTC.",
      retryAfterSeconds: 12 * 3600,
    });
  });

  it("is not limited by the assistant's count", async () => {
    vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 500, askCount: 1 } as never);
    expect((await claimAskQuota("u1")).ok).toBe(true);
  });
});

describe("releaseAskQuota", () => {
  it("gives one question back on that day's row, never below zero", async () => {
    await releaseAskQuota("u1", "2026-11-04");
    expect(prisma.aiUsage.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", day: "2026-11-04", askCount: { gt: 0 } },
      data: { askCount: { decrement: 1 } },
    });
  });

  it("never throws", async () => {
    vi.mocked(prisma.aiUsage.updateMany).mockRejectedValue(new Error("db down"));
    await expect(releaseAskQuota("u1", "2026-11-04")).resolves.toBeUndefined();
  });
});

describe("aiQuotaResponse", () => {
  it("builds a 429 with the error body and Retry-After", async () => {
    const res = aiQuotaResponse({ ok: false, error: MESSAGE, retryAfterSeconds: 42 });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(await res.json()).toEqual({ error: MESSAGE });
  });
});
