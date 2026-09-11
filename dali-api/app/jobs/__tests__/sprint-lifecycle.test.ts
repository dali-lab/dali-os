import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/slack/lib/slack-client", () => ({
  slackConfigured: vi.fn().mockReturnValue(true),
  postMessage: vi.fn().mockResolvedValue({ ts: "1" }),
}));
vi.mock("~/lib/notify.server", () => ({
  notify: vi.fn().mockResolvedValue({ inApp: 2, emailed: 0, slackDmed: 0 }),
}));
vi.mock("~/projects/lib/project-members.server", () => ({
  currentProjectParticipantIds: vi.fn().mockResolvedValue(new Set(["u1", "u2"])),
}));

import { prisma } from "~/lib/db";
import { postMessage } from "~/slack/lib/slack-client";
import { notify } from "~/lib/notify.server";
import { currentProjectParticipantIds } from "~/projects/lib/project-members.server";
import { runSprintLifecycle } from "~/jobs/sprint-lifecycle.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockPost = postMessage as unknown as ReturnType<typeof vi.fn>;
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
    expect(arg.message.title).toBe("Sprint 2 wrapped up");
    expect(arg.message.body).toContain("1 of 2 tasks done");
    expect(arg.message.link).toBe("/projects/p1?tab=board");
    expect(arg.message.dedupKey).toBe(`sprint-closed:p1:${SPRINT2_KEY}`);
    expect(arg.recipients.map((r: { userId: string }) => r.userId).sort()).toEqual(["u1", "u2"]);

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [channel, text] = mockPost.mock.calls[0];
    expect(channel).toBe("C123");
    expect(text).toContain("*Sprint 2* wrapped up");
    expect(text).toContain("1 of 2 tasks done");
    expect(result.items).toBe(1);
  });

  it("does nothing when no sprint ended yesterday", async () => {
    const result = await runSprintLifecycle({ now: MID, lastSuccessAt: null, settings: {} });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("skips a re-fired tick (dedupKey already claimed → no fresh in-app rows)", async () => {
    mockNotify.mockResolvedValue({ inApp: 0, emailed: 0, slackDmed: 0 });
    const result = await runSprintLifecycle({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockPost).not.toHaveBeenCalled(); // gated on the fresh dispatch
    expect(result.items).toBe(0);
  });

  it("skips the wrap-up entirely when nobody is currently on the project", async () => {
    mockParticipants.mockResolvedValue(new Set());
    const result = await runSprintLifecycle({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
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
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.items).toBe(1);
  });

  it("gates the channel post to prod without the override", async () => {
    delete process.env.NOTIFY_SLACK_DM_OVERRIDE;
    const result = await runSprintLifecycle({ now: NOW, lastSuccessAt: null, settings: {} });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockPost).not.toHaveBeenCalled();
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
});
