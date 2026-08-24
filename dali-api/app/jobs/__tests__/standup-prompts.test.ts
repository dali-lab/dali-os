import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/slack/lib/slack-client", () => ({
  slackConfigured: vi.fn().mockReturnValue(true),
  postMessage: vi.fn().mockResolvedValue({ ts: "1" }),
}));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "om-test", deduped: false })),
  drainNow: vi.fn(async () => {}),
}));

import { prisma } from "~/lib/db";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { runStandupPrompts } from "~/jobs/standup-prompts.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;
const mockDrain = drainNow as unknown as ReturnType<typeof vi.fn>;

// Wednesday 2026-07-15, 14:30 UTC = 10:30 ET.
const WEEKDAY_1030_ET = new Date("2026-07-15T14:30:00Z");
// Saturday 2026-07-18.
const SATURDAY = new Date("2026-07-18T14:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTIFY_SLACK_DM_OVERRIDE = "1";
  mockPrisma.project.findMany.mockResolvedValue([
    { id: "p1", slackChannelId: "C1" },
    { id: "p2", slackChannelId: "C2" },
  ]);
});

afterEach(() => {
  delete process.env.NOTIFY_SLACK_DM_OVERRIDE;
});

describe("standup-prompts", () => {
  it("posts to every Active project channel once the send hour passes", async () => {
    const result = await runStandupPrompts({
      now: WEEKDAY_1030_ET,
      lastSuccessAt: null,
      settings: { sendHourEt: 10 },
    });

    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "Active", slackChannelId: { not: null } },
      }),
    );
    // One enqueueOutbound call per project channel, each with channel:"slack_channel"
    const channelCalls = mockEnqueue.mock.calls
      .map((c: any[]) => c[0])
      .filter((a: any) => a.channel === "slack_channel");
    expect(channelCalls).toHaveLength(2);
    expect(channelCalls.find((c: any) => c.target === "C1")).toBeDefined();
    expect(channelCalls.find((c: any) => c.target === "C2")).toBeDefined();
    expect(result.items).toBe(2);
  });

  it("does not post before the send hour", async () => {
    const result = await runStandupPrompts({
      now: new Date("2026-07-15T13:30:00Z"), // 9:30 ET
      lastSuccessAt: null,
      settings: { sendHourEt: 10 },
    });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("does not post twice in one day", async () => {
    const result = await runStandupPrompts({
      now: WEEKDAY_1030_ET,
      lastSuccessAt: new Date("2026-07-15T14:10:00Z"), // already ran today
      settings: { sendHourEt: 10 },
    });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("skips weekends", async () => {
    const result = await runStandupPrompts({
      now: SATURDAY,
      lastSuccessAt: null,
      settings: { sendHourEt: 10 },
    });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(result.note).toContain("weekend");
  });

  it("stays quiet off prod without the override", async () => {
    delete process.env.NOTIFY_SLACK_DM_OVERRIDE;

    const result = await runStandupPrompts({
      now: WEEKDAY_1030_ET,
      lastSuccessAt: null,
      settings: { sendHourEt: 10 },
    });

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("keeps posting to other channels when one enqueue fails", async () => {
    // If the first enqueue rejects, the job catches the error and continues
    // enqueuing the remaining projects. The failed enqueue doesn't push an id,
    // so it's not counted.
    mockEnqueue.mockRejectedValueOnce(new Error("channel_not_found"));

    const result = await runStandupPrompts({
      now: WEEKDAY_1030_ET,
      lastSuccessAt: null,
      settings: { sendHourEt: 10 },
    });

    // Both projects were attempted (enqueue called twice: once throwing, once succeeding).
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    // Only the successful enqueue contributes an id → items = 1.
    expect(result.items).toBe(1);
  });
});
