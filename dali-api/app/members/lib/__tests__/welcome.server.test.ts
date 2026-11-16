import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { user: { findMany: vi.fn() } },
}));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(),
  drainNow: vi.fn(),
}));
vi.mock("~/slack/lib/slack-client", () => ({
  slackConfigured: vi.fn(),
  sendDm: vi.fn(),
}));
vi.mock("~/slack/lib/send-gate", () => ({ slackSendAllowed: vi.fn() }));
vi.mock("~/email/lib/layout.server", () => ({
  renderMemberEmail: vi.fn(() => ({ html: "<p>x</p>", text: "x" })),
}));
vi.mock("~/email/lib/templates.server", () => ({ renderEmailTemplate: vi.fn() }));
vi.mock("~/email/lib/notification-render.server", () => ({
  resolveNotificationCopy: vi.fn(async () => new Map()),
  renderNotificationCopy: vi.fn(() => ({ subject: "Finish onboarding", body: "Please finish." })),
}));
vi.mock("~/lib/app-env", () => ({ getFrontendUrl: () => "https://os.example.edu/" }));

import { prisma } from "~/lib/db.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { slackConfigured, sendDm } from "~/slack/lib/slack-client";
import { slackSendAllowed } from "~/slack/lib/send-gate";
import { sendOnboardingReminders } from "../welcome.server";

const findMany = prisma.user.findMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(slackConfigured).mockReturnValue(true);
  vi.mocked(slackSendAllowed).mockReturnValue(true);
  vi.mocked(enqueueOutbound).mockImplementation(async () => ({ id: "ob", deduped: false }));
});

describe("sendOnboardingReminders via slack", () => {
  it("enqueues one slack_dm per user with a Slack id and skips the rest", async () => {
    findMany.mockResolvedValue([
      { id: "u1", slackUserId: "UADA" },
      { id: "u2", slackUserId: null },
      { id: "u3", slackUserId: "UBOB" },
    ]);

    const res = await sendOnboardingReminders({
      actorId: "core1",
      step: "slack",
      userIds: ["u1", "u2", "u3"],
      via: "slack",
    });

    expect(res).toEqual({ count: 2, skipped: 1 });
    const rows = vi.mocked(enqueueOutbound).mock.calls.map((c) => c[0]);
    expect(rows.map((r) => r.target)).toEqual(["UADA", "UBOB"]);
    expect(rows[0]).toMatchObject({
      channel: "slack_dm",
      recipientUserId: "u1",
      createdByUserId: "core1",
      eventType: "member.onboarding.reminder",
    });
    expect(rows[0].dedupKey).toBeUndefined();
    expect(rows[0].slackText).toContain("*Finish onboarding*");
    expect(rows[0].slackText).toContain("https://os.example.edu/onboarding");
    expect(drainNow).toHaveBeenCalledWith(["ob", "ob"]);
    expect(sendDm).not.toHaveBeenCalled();
  });

  it("still returns the full count when delivery fails after queueing", async () => {
    findMany.mockResolvedValue([
      { id: "u1", slackUserId: "UADA" },
      { id: "u3", slackUserId: "UBOB" },
    ]);
    vi.mocked(drainNow).mockResolvedValue(undefined);
    vi.mocked(sendDm).mockRejectedValue(new Error("slack down"));

    const res = await sendOnboardingReminders({
      actorId: "core1",
      step: "slack",
      userIds: ["u1", "u3"],
      via: "slack",
    });

    expect(res).toEqual({ count: 2, skipped: 0 });
    expect(enqueueOutbound).toHaveBeenCalledTimes(2);
  });

  it("throws before queueing outside prod", async () => {
    vi.mocked(slackSendAllowed).mockReturnValue(false);
    await expect(
      sendOnboardingReminders({ actorId: "c", step: "slack", userIds: ["u1"], via: "slack" }),
    ).rejects.toThrow(/production-only/);
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("throws when Slack is not configured", async () => {
    vi.mocked(slackConfigured).mockReturnValue(false);
    await expect(
      sendOnboardingReminders({ actorId: "c", step: "slack", userIds: ["u1"], via: "slack" }),
    ).rejects.toThrow(/not configured/);
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });
});

describe("sendOnboardingReminders via email", () => {
  it("enqueues one email per address and records the actor", async () => {
    findMany.mockResolvedValue([
      { id: "u1", firstName: "Ada", daliEmail: "ada@example.edu", dartmouthEmail: null },
      { id: "u2", firstName: "Bo", daliEmail: null, dartmouthEmail: null },
    ]);

    const res = await sendOnboardingReminders({
      actorId: "core1",
      step: "email",
      userIds: ["u1", "u2"],
      via: "emailDali",
    });

    expect(res).toEqual({ count: 1, skipped: 1 });
    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueueOutbound).mock.calls[0][0]).toMatchObject({
      channel: "email",
      target: "ada@example.edu",
      createdByUserId: "core1",
    });
  });
});
