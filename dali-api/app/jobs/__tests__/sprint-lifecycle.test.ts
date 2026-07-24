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

// The job queries sprints twice per tick — Active-past-endsAt (close pass)
// then Planned-past-startsAt (activation pass). Dispatch on the where clause.
function mockDueSprints({
  closeDue = [] as Record<string, unknown>[],
  startDue = [] as { id: string }[],
} = {}) {
  mockPrisma.sprint.findMany.mockImplementation(({ where }) =>
    Promise.resolve(where.status === "Active" ? closeDue : startDue),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTIFY_SLACK_DM_OVERRIDE = "1"; // non-prod test env
  mockDueSprints({ closeDue: [dueSprint()] });
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
    mockDueSprints({
      closeDue: [dueSprint({ project: { name: "DALI OS", slackChannelId: null } })],
    });

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
    mockDueSprints({
      closeDue: [dueSprint(), dueSprint({ id: "s9", name: "Sprint 9" })],
    });
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

  it("activates every Planned sprint past startsAt — parallel sprints allowed", async () => {
    mockDueSprints({ startDue: [{ id: "a1" }, { id: "a2" }] });

    const result = await runSprintLifecycle({
      now: NOW,
      lastSuccessAt: null,
      settings: {},
    });

    expect(mockPrisma.sprint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "Planned", startsAt: { lte: NOW } },
      }),
    );
    for (const id of ["a1", "a2"]) {
      expect(mockPrisma.sprint.updateMany).toHaveBeenCalledWith({
        where: { id, status: "Planned" },
        data: { status: "Active" },
      });
    }
    expect(result.items).toBe(2);
    // Activation is silent — the close-out summary is the only channel post.
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("skips activating a sprint another machine already claimed", async () => {
    mockDueSprints({ startDue: [{ id: "a1" }] });
    mockPrisma.sprint.updateMany.mockResolvedValue({ count: 0 });

    const result = await runSprintLifecycle({
      now: NOW,
      lastSuccessAt: null,
      settings: {},
    });

    expect(result.items).toBe(0);
  });

  it("counts closes and activations together in one tick", async () => {
    mockDueSprints({ closeDue: [dueSprint()], startDue: [{ id: "a1" }] });

    const result = await runSprintLifecycle({
      now: NOW,
      lastSuccessAt: null,
      settings: {},
    });

    expect(result.items).toBe(2);
  });
});
