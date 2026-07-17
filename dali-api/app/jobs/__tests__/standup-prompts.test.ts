import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/slack/lib/slack-client", () => ({
  slackConfigured: vi.fn().mockReturnValue(true),
  postMessage: vi.fn().mockResolvedValue({ ts: "1" }),
}));

import { prisma } from "~/lib/db";
import { postMessage } from "~/slack/lib/slack-client";
import { runStandupPrompts } from "~/jobs/standup-prompts.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockPost = postMessage as unknown as ReturnType<typeof vi.fn>;

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
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(result.items).toBe(2);
  });

  it("does not post before the send hour", async () => {
    const result = await runStandupPrompts({
      now: new Date("2026-07-15T13:30:00Z"), // 9:30 ET
      lastSuccessAt: null,
      settings: { sendHourEt: 10 },
    });

    expect(mockPost).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("does not post twice in one day", async () => {
    const result = await runStandupPrompts({
      now: WEEKDAY_1030_ET,
      lastSuccessAt: new Date("2026-07-15T14:10:00Z"), // already ran today
      settings: { sendHourEt: 10 },
    });

    expect(mockPost).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("skips weekends", async () => {
    const result = await runStandupPrompts({
      now: SATURDAY,
      lastSuccessAt: null,
      settings: { sendHourEt: 10 },
    });

    expect(mockPost).not.toHaveBeenCalled();
    expect(result.note).toContain("weekend");
  });

  it("stays quiet off prod without the override", async () => {
    delete process.env.NOTIFY_SLACK_DM_OVERRIDE;

    const result = await runStandupPrompts({
      now: WEEKDAY_1030_ET,
      lastSuccessAt: null,
      settings: { sendHourEt: 10 },
    });

    expect(mockPost).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("keeps posting to other channels when one post fails", async () => {
    mockPost.mockRejectedValueOnce(new Error("channel_not_found"));

    const result = await runStandupPrompts({
      now: WEEKDAY_1030_ET,
      lastSuccessAt: null,
      settings: { sendHourEt: 10 },
    });

    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(result.items).toBe(1);
  });
});
