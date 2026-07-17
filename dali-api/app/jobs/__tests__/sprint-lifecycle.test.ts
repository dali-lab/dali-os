import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/slack/lib/slack-client", () => ({
  slackConfigured: vi.fn().mockReturnValue(true),
  postMessage: vi.fn().mockResolvedValue({ ts: "1" }),
}));

import { prisma } from "~/lib/db";
import { postMessage } from "~/slack/lib/slack-client";
import { runSprintLifecycle } from "~/jobs/sprint-lifecycle.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockPost = postMessage as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-07-15T12:00:00Z");

function dueSprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    name: "Sprint 3",
    projectId: "p1",
    endsAt: new Date("2026-07-14T00:00:00Z"),
    project: { name: "DALI OS", slackChannelId: "C123" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTIFY_SLACK_DM_OVERRIDE = "1"; // non-prod test env
  mockPrisma.sprint.findMany.mockResolvedValue([dueSprint()]);
  mockPrisma.sprint.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.sprint.findFirst.mockResolvedValue(null);
  mockPrisma.task.findMany.mockResolvedValue([
    { status: "Done" },
    { status: "Todo" },
    { status: "Cancelled" },
  ]);
  mockPrisma.task.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  delete process.env.NOTIFY_SLACK_DM_OVERRIDE;
});

describe("sprint-lifecycle", () => {
  it("closes the sprint, rolls unfinished tasks to the backlog, posts a summary", async () => {
    const result = await runSprintLifecycle({
      now: NOW,
      lastSuccessAt: null,
      settings: {},
    });

    expect(mockPrisma.sprint.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", status: "Active" },
      data: { status: "Closed" },
    });
    expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
      where: { sprintId: "s1", status: { notIn: ["Done", "Cancelled"] } },
      data: { sprintId: null },
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [channel, text] = mockPost.mock.calls[0];
    expect(channel).toBe("C123");
    expect(text).toContain("Sprint *Sprint 3* is closed");
    expect(text).toContain("1 of 3 tasks done");
    expect(text).toContain("moved to the backlog");
    expect(result.items).toBe(1);
  });

  it("rolls unfinished tasks into the next Planned sprint when one exists", async () => {
    mockPrisma.sprint.findFirst.mockResolvedValue({ id: "s2", name: "Sprint 4" });

    await runSprintLifecycle({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
      where: { sprintId: "s1", status: { notIn: ["Done", "Cancelled"] } },
      data: { sprintId: "s2" },
    });
    expect(mockPost.mock.calls[0][1]).toContain('moved to "Sprint 4"');
  });

  it("skips a sprint another machine already claimed", async () => {
    mockPrisma.sprint.updateMany.mockResolvedValue({ count: 0 });

    const result = await runSprintLifecycle({
      now: NOW,
      lastSuccessAt: null,
      settings: {},
    });

    expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("skips the Slack post when the project has no channel", async () => {
    mockPrisma.sprint.findMany.mockResolvedValue([
      dueSprint({ project: { name: "DALI OS", slackChannelId: null } }),
    ]);

    const result = await runSprintLifecycle({
      now: NOW,
      lastSuccessAt: null,
      settings: {},
    });

    expect(mockPost).not.toHaveBeenCalled();
    expect(result.items).toBe(1);
  });

  it("gates the channel post to prod without the override", async () => {
    delete process.env.NOTIFY_SLACK_DM_OVERRIDE;

    const result = await runSprintLifecycle({
      now: NOW,
      lastSuccessAt: null,
      settings: {},
    });

    expect(mockPost).not.toHaveBeenCalled();
    expect(result.items).toBe(1); // close-out itself still runs
  });

  it("keeps closing the rest of the batch when one close-out fails", async () => {
    mockPrisma.sprint.findMany.mockResolvedValue([
      dueSprint(),
      dueSprint({ id: "s9", name: "Sprint 9" }),
    ]);
    mockPrisma.task.findMany
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue([]);

    const result = await runSprintLifecycle({
      now: NOW,
      lastSuccessAt: null,
      settings: {},
    });

    expect(result.items).toBe(1);
    expect(result.note).toContain("1 close-out(s) failed");
  });
});
