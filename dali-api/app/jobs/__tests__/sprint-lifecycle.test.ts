import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/slack/lib/slack-client", () => ({
  slackConfigured: vi.fn().mockReturnValue(true),
  postMessage: vi.fn(),
}));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn().mockResolvedValue({ id: "ob1", deduped: false }),
  drainNow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/notify.server", () => ({
  notify: vi.fn().mockResolvedValue({ inApp: 2, emailed: 0, slackDmed: 0 }),
}));
vi.mock("~/projects/lib/project-members.server", () => ({
  currentProjectParticipantIds: vi.fn().mockResolvedValue(new Set(["u1", "u2"])),
}));

import { prisma } from "~/lib/db.server";
import { postMessage } from "~/slack/lib/slack-client";
import { notify } from "~/lib/notify.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { currentProjectParticipantIds } from "~/projects/lib/project-members.server";
import { runSprintLifecycle } from "~/jobs/sprint-lifecycle.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockPost = postMessage as unknown as ReturnType<typeof vi.fn>;
const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;
const mockDrain = drainNow as unknown as ReturnType<typeof vi.fn>;
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;
const mockParticipants =
  currentProjectParticipantIds as unknown as ReturnType<typeof vi.fn>;

// Term: Jul 1 → Sep 1. Sprint 1 = Jul 1–7, Sprint 2 = Jul 8–14, Sprint 3 = Jul 15…
// NOW = Jul 15 → yesterday Jul 14 = the last day of Sprint 2, so Sprint 2 just
// closed. The band key is the UTC midnight of Jul 8.
const NOW = new Date("2026-07-15T12:00:00Z");
const MID = new Date("2026-07-17T12:00:00Z"); // yesterday (Jul 16) is mid-sprint
const SPRINT2_KEY = Date.UTC(2026, 6, 8);

function activeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "DALI OS",
    slackChannelId: "C123",
    projectTerms: [
      {
        term: {
          startDate: new Date("2026-07-01T00:00:00Z"),
          endDate: new Date("2026-09-01T00:00:00Z"),
        },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTIFY_SLACK_DM_OVERRIDE = "1"; // non-prod test env
  mockPrisma.project.findMany.mockResolvedValue([activeProject()]);
  mockPrisma.task.findMany.mockResolvedValue([{ status: "Done" }, { status: "Todo" }]);
  mockParticipants.mockResolvedValue(new Set(["u1", "u2"]));
  mockNotify.mockResolvedValue({ inApp: 2, emailed: 0, slackDmed: 0 });
});

afterEach(() => {
  delete process.env.NOTIFY_SLACK_DM_OVERRIDE;
});

describe("sprint-lifecycle (per-sprint wrap-up)", () => {
  it("notifies members and posts to Slack the day after a sprint ends", async () => {
    const result = await runSprintLifecycle({ now: NOW, lastSuccessAt: null, settings: {} });

    expect(mockParticipants).toHaveBeenCalledWith("p1");
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const arg = mockNotify.mock.calls[0][0];
    expect(arg.eventType).toBe("project.sprint_closed");
    expect(arg.message.vars.itemTitle).toBe("Sprint 2");
    expect(arg.message.vars.contextName).toBe("DALI OS");
    expect(arg.message.vars.itemDetail).toContain("1 of 2 tasks done");
    expect(arg.message.link).toBe("/projects/p1?tab=board");
    expect(arg.message.dedupKey).toBe(`sprint-closed:p1:${SPRINT2_KEY}`);
    expect(arg.recipients.map((r: { userId: string }) => r.userId).sort()).toEqual(["u1", "u2"]);

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const row = mockEnqueue.mock.calls[0][0];
    expect(row.channel).toBe("slack_channel");
    expect(row.target).toBe("C123");
    expect(row.dedupKey).toBe(`slack.sprint_closed:p1:${SPRINT2_KEY}`);
    expect(row.slackText).toContain("*Sprint 2* wrapped up");
    expect(row.slackText).toContain("1 of 2 tasks done");
    expect(mockDrain).toHaveBeenCalledWith(["ob1"]);
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.items).toBe(1);
  });

  it("does nothing when no sprint ended yesterday", async () => {
    const result = await runSprintLifecycle({ now: MID, lastSuccessAt: null, settings: {} });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("skips a re-fired tick (in-app already claimed) and leaves dedup to the outbox", async () => {
    mockNotify.mockResolvedValue({ inApp: 0, emailed: 0, slackDmed: 0 });
    const result = await runSprintLifecycle({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][0].dedupKey).toBe(`slack.sprint_closed:p1:${SPRINT2_KEY}`);
    expect(result.items).toBe(0);
  });

  it("skips the wrap-up entirely when nobody is currently on the project", async () => {
    mockParticipants.mockResolvedValue(new Set());
    const result = await runSprintLifecycle({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("skips an empty sprint (no tasks due in it)", async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    const result = await runSprintLifecycle({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("skips the Slack post when the project has no channel", async () => {
    mockPrisma.project.findMany.mockResolvedValue([activeProject({ slackChannelId: null })]);
    const result = await runSprintLifecycle({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(result.items).toBe(1);
  });

  it("gates the channel post to prod without the override", async () => {
    delete process.env.NOTIFY_SLACK_DM_OVERRIDE;
    const result = await runSprintLifecycle({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(result.items).toBe(1);
  });

  it("keeps going through the batch when one project's wrap-up throws", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      activeProject(),
      activeProject({ id: "p2" }),
    ]);
    mockPrisma.task.findMany
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue([{ status: "Done" }]);
    const result = await runSprintLifecycle({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(result.items).toBe(1);
    expect(result.note).toContain("1 wrap-up(s) failed");
  });

  it("keeps going when one project's enqueue throws", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      activeProject(),
      activeProject({ id: "p2", slackChannelId: "C456" }),
    ]);
    mockEnqueue
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({ id: "ob2", deduped: false });
    const result = await runSprintLifecycle({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    expect(mockDrain).toHaveBeenCalledWith(["ob2"]);
    expect(result.note).toContain("1 wrap-up(s) failed");
  });
});
