import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    outboundMessage: { count: vi.fn() },
    scheduledJob: { findMany: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import { loadAdminAttention } from "~/admin/lib/attention.server";

const count = vi.mocked(prisma.outboundMessage.count);
const jobs = vi.mocked(prisma.scheduledJob.findMany);

beforeEach(() => vi.clearAllMocks());

describe("loadAdminAttention", () => {
  it("is empty when nothing failed", async () => {
    count.mockResolvedValue(0);
    jobs.mockResolvedValue([]);
    expect(await loadAdminAttention()).toEqual({ counts: { messaging: 0, platform: 0 }, items: [] });
  });

  it("counts only dead messages and enabled jobs whose last run errored", async () => {
    count.mockResolvedValue(3);
    jobs.mockResolvedValue([{ name: "digest", lastError: "cap reached" }] as never);
    const { counts, items } = await loadAdminAttention();
    expect(count).toHaveBeenCalledWith({ where: { status: "Dead" } });
    expect(jobs.mock.calls[0]![0]).toMatchObject({ where: { enabled: true, lastStatus: "Error" } });
    expect(counts).toEqual({ messaging: 3, platform: 1 });
    expect(items.map((i) => [i.key, i.severity, i.to])).toEqual([
      ["outbox-dead", "red", "/admin/messaging/outbox?status=Dead"],
      ["job-digest", "red", "/admin/platform/jobs"],
    ]);
    expect(items[0]!.title).toBe("3 outbound messages failed permanently");
    expect(items[1]!.detail).toBe("Last error: cap reached");
  });

  it("says one message, singular, and covers a job with no recorded error", async () => {
    count.mockResolvedValue(1);
    jobs.mockResolvedValue([{ name: "sweep", lastError: null }] as never);
    const { items } = await loadAdminAttention();
    expect(items[0]!.title).toBe("1 outbound message failed permanently");
    expect(items[1]!.detail).toBe("Its last run ended in an error.");
  });
});
