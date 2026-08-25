import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(),
  drainNow: vi.fn(),
}));
vi.mock("~/slack/lib/slack-client", () => ({ slackConfigured: vi.fn() }));
vi.mock("~/lib/app-env", () => ({
  getAppEnv: vi.fn(),
  getFrontendUrl: vi.fn(() => "https://os.dali.dartmouth.edu"),
}));

import { prisma } from "~/lib/db";
import { enqueueOutbound } from "~/lib/outbound.server";
import { slackConfigured } from "~/slack/lib/slack-client";
import { getAppEnv } from "~/lib/app-env";
import { notify } from "~/lib/notify.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;
const mockSlackConfigured = slackConfigured as unknown as ReturnType<typeof vi.fn>;
const mockGetAppEnv = getAppEnv as unknown as ReturnType<typeof vi.fn>;

// notify() now routes email/Slack through the outbox — it enqueues instead of
// calling sendEmail/sendDm directly, and the drain (not notify) stamps
// emailedAt/slackDmAt. These helpers read the enqueued payloads by channel.
const emailCalls = () =>
  mockEnqueue.mock.calls.map((c) => c[0]).filter((a) => a.channel === "email");
const slackCalls = () =>
  mockEnqueue.mock.calls.map((c) => c[0]).filter((a) => a.channel === "slack_dm");

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
  mockPrisma.notification.findFirst.mockResolvedValue(null); // no coalesce suppression by default
  mockPrisma.notification.update.mockResolvedValue({}); // merge path awaits + .catch()es this
  mockPrisma.notification.createManyAndReturn.mockImplementation(
    ({ data }: { data: { recipientUserId: string }[] }) =>
      Promise.resolve(
        data.map((d, i) => ({ id: `n-${i}`, recipientUserId: d.recipientUserId })),
      ),
  );
  mockEnqueue.mockResolvedValue({ id: "om-x", deduped: false });
  mockSlackConfigured.mockReturnValue(true);
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
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("enqueues an email by default for Instant-default events", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    const res = await notify({
      eventType: "education.announcement",
      message: { title: "Announcement", body: "Hello" },
      recipients: [{ userId: "u1" }],
    });
    expect(res.emailed).toBe(1);
    const email = emailCalls()[0];
    expect(email).toMatchObject({
      channel: "email",
      purpose: "General",
      target: "u1@dali.dartmouth.edu",
      subject: "Announcement",
      // links the in-app row so the drain can stamp emailedAt on delivery
      notificationId: "n-0",
    });
    // Every instant email carries its own off-switch path.
    expect(email.bodyHtml).toContain("https://os.dali.dartmouth.edu/settings/notifications");
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
    expect(emailCalls()).toHaveLength(1);
    expect(emailCalls()[0].target).toBe("u2@dali.dartmouth.edu");
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
    expect(emailCalls()).toHaveLength(0); // Daily ≠ Instant
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

  it("enqueues one email per instant recipient (delivery/retry is the drain's job)", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1"), user("u2")]);
    const res = await notify({
      eventType: "education.announcement",
      message: { title: "T" },
      recipients: [{ userId: "u1" }, { userId: "u2" }],
    });
    expect(res).toEqual({ inApp: 2, emailed: 2, slackDmed: 0 });
    expect(emailCalls().map((c) => c.target).sort()).toEqual([
      "u1@dali.dartmouth.edu",
      "u2@dali.dartmouth.edu",
    ]);
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
    expect(emailCalls()).toHaveLength(0);
  });

  it("ccDartmouth: emails both the DALI and Dartmouth addresses in one message", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      user("u1", { dartmouthEmail: "ada@dartmouth.edu" }),
    ]);
    await notify({
      eventType: "education.announcement",
      message: { title: "T", ccDartmouth: true },
      recipients: [{ userId: "u1" }],
    });
    expect(emailCalls()[0].target).toBe("u1@dali.dartmouth.edu, ada@dartmouth.edu");
  });

  it("ccDartmouth: derives the Dartmouth address from netId, excluding personal", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      user("u1", { netId: "f00abc", personalEmail: "ada@gmail.com" }),
    ]);
    await notify({
      eventType: "education.announcement",
      message: { title: "T", ccDartmouth: true },
      recipients: [{ userId: "u1" }],
    });
    expect(emailCalls()[0].target).toBe("u1@dali.dartmouth.edu, f00abc@dartmouth.edu");
  });

  it("ccDartmouth: sends only the DALI address when no Dartmouth address resolves", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]); // no dartmouthEmail, no netId
    await notify({
      eventType: "education.announcement",
      message: { title: "T", ccDartmouth: true },
      recipients: [{ userId: "u1" }],
    });
    expect(emailCalls()[0].target).toBe("u1@dali.dartmouth.edu");
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
    expect(emailCalls()[0].target).toBe("f00xyz@dartmouth.edu");
  });

  it("enqueues Slack DMs in prod when the pref is on and slackUserId is set", async () => {
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
    expect(slackCalls()).toHaveLength(1);
    expect(slackCalls()[0].target).toBe("U123");
    expect(slackCalls()[0].slackText).toContain("*T*");
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
    expect(slackCalls()).toHaveLength(0);

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

  it("passes per-recipient ics on the email enqueue but keeps it off the row insert", async () => {
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
    expect(emailCalls()).toHaveLength(1);
    expect(emailCalls()[0].ics).toBe("BEGIN:VCALENDAR\r\nEND:VCALENDAR");
    const inserted =
      mockPrisma.notification.createManyAndReturn.mock.calls[0][0].data[0];
    expect("ics" in inserted).toBe(false);
  });

  it("drops the redundant in-body title for an announcement that carries a body", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    await notify({
      eventType: "announcement",
      message: { title: "Lab news", body: "The actual message." },
      recipients: [{ userId: "u1" }],
    });
    const email = emailCalls()[0];
    expect(email.subject).toBe("Lab news"); // title still carried by the subject
    expect(email.bodyHtml).not.toContain("<strong>Lab news</strong>");
    expect(email.bodyHtml).toContain("The actual message.");
  });

  it("keeps the in-body title for a body-less announcement (never an empty email)", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    await notify({
      eventType: "announcement",
      message: { title: "Lab meeting moved to 5pm" },
      recipients: [{ userId: "u1" }],
    });
    expect(emailCalls()[0].bodyHtml).toContain(
      "<strong>Lab meeting moved to 5pm</strong>",
    );
  });

  it("keeps the in-body title for non-announcement events even with a body", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    await notify({
      eventType: "education.announcement",
      message: { title: "Course update", body: "Details here." },
      recipients: [{ userId: "u1" }],
    });
    expect(emailCalls()[0].bodyHtml).toContain("<strong>Course update</strong>");
  });

  it("renders a rich HTML body and an attached-form CTA button in the email", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    await notify({
      eventType: "announcement",
      message: {
        title: "Please sign",
        bodyHtml: '<p>Read <a href="https://x.com">this</a> first.</p>',
        link: "/forms/fill/tok123",
        linkLabel: "Open the form",
      },
      recipients: [{ userId: "u1" }],
    });
    const html = emailCalls()[0].bodyHtml;
    // Rich body link survives sanitization with safe target/rel.
    expect(html).toContain('href="https://x.com"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    // CTA button points at the absolutized form fill URL with the custom label.
    expect(html).toContain("https://os.dali.dartmouth.edu/forms/fill/tok123");
    expect(html).toContain("Open the form");
    // Body present → the duplicate title heading is suppressed.
    expect(html).not.toContain("<strong>Please sign</strong>");
  });
});

describe("notify — coalescing / merge", () => {
  // task.comment has coalesceWindowMs + coalesceNoun "comment". When a recent
  // row for the same (recipient, eventType, link) exists, the burst merges into
  // it instead of writing a new row.
  it("merges into an existing row instead of writing a new one", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    mockPrisma.notification.findFirst.mockResolvedValue({ id: "existing-1", coalesceCount: 1 });

    const res = await notify({
      eventType: "task.comment",
      message: { title: "New comment on: Task X", body: "second comment", link: "/t/1" },
      recipients: [{ userId: "u1" }],
    });

    // No fresh in-app row, no email/Slack — only the existing row is updated.
    expect(mockPrisma.notification.createManyAndReturn).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(res.inApp).toBe(0);

    expect(mockPrisma.notification.update).toHaveBeenCalledTimes(1);
    const { where, data } = mockPrisma.notification.update.mock.calls[0][0];
    expect(where).toEqual({ id: "existing-1" });
    // Re-lit unread, bumped to top, count incremented, preview refreshed.
    expect(data.readAt).toBeNull();
    expect(data.createdAt).toBeInstanceOf(Date);
    expect(data.coalesceCount).toEqual({ increment: 1 });
    expect(data.body).toBe("2 new comments · latest: second comment");
    expect(data.title).toBe("New comment on: Task X");
  });

  it("writes a fresh row when nothing recent exists (no suppression)", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    mockPrisma.notification.findFirst.mockResolvedValue(null);

    await notify({
      eventType: "task.comment",
      message: { title: "New comment on: Task X", body: "first comment", link: "/t/1" },
      recipients: [{ userId: "u1" }],
    });

    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    expect(mockPrisma.notification.createManyAndReturn).toHaveBeenCalledTimes(1);
  });

  it("reflects the running count in the merged body", async () => {
    mockPrisma.user.findMany.mockResolvedValue([user("u1")]);
    mockPrisma.notification.findFirst.mockResolvedValue({ id: "existing-1", coalesceCount: 4 });

    await notify({
      eventType: "task.comment",
      message: { title: "New comment on: Task X", body: "fifth comment", link: "/t/1" },
      recipients: [{ userId: "u1" }],
    });

    const { data } = mockPrisma.notification.update.mock.calls[0][0];
    expect(data.body).toBe("5 new comments · latest: fifth comment");
  });
});
