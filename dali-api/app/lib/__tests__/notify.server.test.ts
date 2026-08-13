import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/gmail", () => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/gmail-integration", () => ({
  getSender: vi.fn(),
  noteSenderHealth: vi.fn(),
}));
vi.mock("~/slack/lib/slack-client", () => ({
  slackConfigured: vi.fn(),
  sendDm: vi.fn(),
}));
vi.mock("~/lib/app-env", () => ({
  getAppEnv: vi.fn(),
  getFrontendUrl: vi.fn(() => "https://os.dali.dartmouth.edu"),
}));

import { prisma } from "~/lib/db";
import { sendEmail } from "~/lib/gmail";
import { getSender } from "~/lib/gmail-integration";
import { slackConfigured, sendDm } from "~/slack/lib/slack-client";
import { getAppEnv } from "~/lib/app-env";
import { notify } from "~/lib/notify.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockSendEmail = sendEmail as unknown as ReturnType<typeof vi.fn>;
const mockGetSender = getSender as unknown as ReturnType<typeof vi.fn>;
const mockSlackConfigured = slackConfigured as unknown as ReturnType<typeof vi.fn>;
const mockSendDm = sendDm as unknown as ReturnType<typeof vi.fn>;
const mockGetAppEnv = getAppEnv as unknown as ReturnType<typeof vi.fn>;

function user(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    firstName: id,
    daliEmail: `${id}@dali.dartmouth.edu`,
    dartmouthEmail: null,
    personalEmail: null,
    netId: null,
    slackUserId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.NOTIFY_SLACK_DM_OVERRIDE;
  mockGetAppEnv.mockReturnValue("prod");
  mockPrisma.notificationPreference.findMany.mockResolvedValue([]);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.notification.createManyAndReturn.mockImplementation(
    ({ data }: { data: { recipientUserId: string }[] }) =>
      Promise.resolve(
        data.map((d, i) => ({ id: `n-${i}`, recipientUserId: d.recipientUserId })),
      ),
  );
  mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
  mockGetSender.mockResolvedValue({
    id: "g-1",
    refreshToken: "token-1",
    sendAsEmail: "dalios@dali.dartmouth.edu",
  });
  mockSendEmail.mockResolvedValue({});
  mockSlackConfigured.mockReturnValue(true);
  mockSendDm.mockResolvedValue({ ts: "1" });
});

describe("notify", () => {
  it("no-ops on an empty recipient list", async () => {
    const res = await notify({
      eventType: "education.discussion",
      message: { title: "T" },
      recipients: [],
    });
    expect(res).toEqual({ inApp: 0, emailed: 0, slackDmed: 0 });
    expect(mockPrisma.notification.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("applies registry defaults when no preference rows exist (default-Off event)", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1"), user("u2")]);
    const res = await notify({
      eventType: "education.discussion",
      message: { title: "New reply" },
      recipients: [{ userId: "u1" }, { userId: "u2" }],
    });
    expect(res).toEqual({ inApp: 2, emailed: 0, slackDmed: 0 });
    expect(mockPrisma.notification.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendDm).not.toHaveBeenCalled();
  });

  it("emails by default for Instant-default events and marks emailedAt", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    const res = await notify({
      eventType: "education.announcement",
      message: { title: "Announcement", body: "Hello" },
      recipients: [{ userId: "u1" }],
    });
    expect(res.emailed).toBe(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "u1@dali.dartmouth.edu",
        subject: "Announcement",
        // From must match the resolved sender's mailbox, not the hardcoded
        // applications@ address — that mismatch is what broke General email.
        from: "dalios@dali.dartmouth.edu",
      }),
    );
    // Every instant email carries its own off-switch path.
    expect(mockSendEmail.mock.calls[0][0].html).toContain(
      "https://os.dali.dartmouth.edu/settings/notifications",
    );
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["n-0"] } },
        data: { emailedAt: expect.any(Date) },
      }),
    );
  });

  it("emails both the dali and dartmouth address when a member has both", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      user("u1", { dartmouthEmail: "u1@dartmouth.edu" }),
    ]);
    await notify({
      eventType: "education.announcement",
      message: { title: "T" },
      recipients: [{ userId: "u1" }],
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "u1@dali.dartmouth.edu, u1@dartmouth.edu" }),
    );
  });

  it("honors explicit preference rows over defaults in a mixed fan-out", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1"), user("u2")]);
    // u1 opted out of email for an Instant-default event; u2 keeps the default.
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      {
        userId: "u1",
        eventType: "education.announcement",
        inApp: true,
        slackDm: false,
        digestFrequency: "Off",
      },
    ]);
    const res = await notify({
      eventType: "education.announcement",
      message: { title: "T" },
      recipients: [{ userId: "u1" }, { userId: "u2" }],
    });
    expect(res).toEqual({ inApp: 2, emailed: 1, slackDmed: 0 });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "u2@dali.dartmouth.edu" }),
    );
  });

  it("forces in-app when a digest is selected — digests are built from in-app rows", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      {
        userId: "u1",
        eventType: "education.discussion",
        inApp: false, // opted out of the bell…
        slackDm: false,
        digestFrequency: "Daily", // …but subscribed to the digest
      },
    ]);
    const res = await notify({
      eventType: "education.discussion",
      message: { title: "T" },
      recipients: [{ userId: "u1" }],
    });
    expect(res.inApp).toBe(1); // row exists for the digest to pick up
    expect(mockSendEmail).not.toHaveBeenCalled(); // Daily ≠ Instant
  });

  it("forces in-app for lockedInApp events despite an opt-out row", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      {
        userId: "u1",
        eventType: "meeting.invite",
        inApp: false,
        slackDm: false,
        digestFrequency: "Off",
      },
    ]);
    const res = await notify({
      eventType: "meeting.invite",
      message: { title: "Meeting invite", scheduledMeetingId: "m1" },
      recipients: [{ userId: "u1" }],
    });
    expect(res.inApp).toBe(1);
  });

  it("stamps eventType and registry kind, honoring per-recipient overrides", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1"), user("u2")]);
    await notify({
      eventType: "hiring.interview_assigned",
      createdByUserId: "core-1",
      message: { title: "Interview assigned" },
      recipients: [
        { userId: "u1", title: "Interview: Ada", interviewAssignmentId: "ia-1" },
        { userId: "u2", interviewAssignmentId: "ia-2" },
      ],
    });
    const { data } = mockPrisma.notification.createManyAndReturn.mock.calls[0][0];
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      recipientUserId: "u1",
      createdByUserId: "core-1",
      eventType: "hiring.interview_assigned",
      kind: "General",
      title: "Interview: Ada",
      interviewAssignmentId: "ia-1",
    });
    expect(data[1]).toMatchObject({
      recipientUserId: "u2",
      title: "Interview assigned",
      interviewAssignmentId: "ia-2",
    });
  });

  it("dedupes recipients by userId", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    const res = await notify({
      eventType: "education.discussion",
      message: { title: "T" },
      recipients: [{ userId: "u1" }, { userId: "u1", title: "dupe" }],
    });
    expect(res.inApp).toBe(1);
  });

  it("isolates per-recipient email failures and marks only successes", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1"), user("u2")]);
    mockSendEmail
      .mockRejectedValueOnce(new Error("bounce"))
      .mockResolvedValueOnce({});
    const res = await notify({
      eventType: "education.announcement",
      message: { title: "T" },
      recipients: [{ userId: "u1" }, { userId: "u2" }],
    });
    expect(res).toEqual({ inApp: 2, emailed: 1, slackDmed: 0 });
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["n-1"] } },
        data: { emailedAt: expect.any(Date) },
      }),
    );
  });

  it("never emails externalEmail events, even with an Instant row", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      {
        userId: "u1",
        eventType: "education.decision",
        inApp: true,
        slackDm: false,
        digestFrequency: "Instant",
      },
    ]);
    const res = await notify({
      eventType: "education.decision",
      message: { title: "You're in" },
      recipients: [{ userId: "u1" }],
    });
    expect(res.emailed).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("falls back to netId@dartmouth.edu for portal students", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      user("u1", { daliEmail: null, netId: "f00xyz" }),
    ]);
    await notify({
      eventType: "education.announcement",
      message: { title: "T" },
      recipients: [{ userId: "u1" }],
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "f00xyz@dartmouth.edu" }),
    );
  });

  it("sends Slack DMs in prod when the pref is on and slackUserId is set", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      user("u1", { slackUserId: "U123" }),
      user("u2"), // no slackUserId — silently skipped
    ]);
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      { userId: "u1", eventType: "education.discussion", inApp: true, slackDm: true, digestFrequency: "Off" },
      { userId: "u2", eventType: "education.discussion", inApp: true, slackDm: true, digestFrequency: "Off" },
    ]);
    const res = await notify({
      eventType: "education.discussion",
      message: { title: "T", link: "/x" },
      recipients: [{ userId: "u1" }, { userId: "u2" }],
    });
    expect(res.slackDmed).toBe(1);
    expect(mockSendDm).toHaveBeenCalledTimes(1);
    expect(mockSendDm).toHaveBeenCalledWith("U123", expect.stringContaining("*T*"));
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { slackDmAt: expect.any(Date) } }),
    );
  });

  it("skips Slack DMs off-prod unless the override is set", async () => {
    mockGetAppEnv.mockReturnValue("staging");
    mockPrisma.user.findMany.mockResolvedValue([user("u1", { slackUserId: "U123" })]);
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      { userId: "u1", eventType: "education.discussion", inApp: true, slackDm: true, digestFrequency: "Off" },
    ]);

    let res = await notify({
      eventType: "education.discussion",
      message: { title: "T" },
      recipients: [{ userId: "u1" }],
    });
    expect(res.slackDmed).toBe(0);
    expect(mockSendDm).not.toHaveBeenCalled();

    process.env.NOTIFY_SLACK_DM_OVERRIDE = "1";
    res = await notify({
      eventType: "education.discussion",
      message: { title: "T" },
      recipients: [{ userId: "u1" }],
    });
    expect(res.slackDmed).toBe(1);
  });

  it("uses task.due_reminder's Slack-on default without any preference row", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1", { slackUserId: "U123" })]);
    const res = await notify({
      eventType: "task.due_reminder",
      message: { title: "Task due" },
      recipients: [{ userId: "u1" }],
    });
    expect(res.slackDmed).toBe(1);
  });

  it("passes per-recipient ics to sendEmail but keeps it off the row insert", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      {
        userId: "u1",
        eventType: "meeting.invite",
        inApp: true,
        slackDm: false,
        digestFrequency: "Instant",
      },
    ]);

    const res = await notify({
      eventType: "meeting.invite",
      message: { title: "Meeting invite: Sync" },
      recipients: [{ userId: "u1", ics: "BEGIN:VCALENDAR\r\nEND:VCALENDAR" }],
    });

    expect(res.emailed).toBe(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].ics).toBe(
      "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
    );
    const inserted =
      mockPrisma.notification.createManyAndReturn.mock.calls[0][0].data[0];
    expect("ics" in inserted).toBe(false);
  });
});
