import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/gmail", () => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/gmail-integration", () => ({ getSender: vi.fn(), noteSenderHealth: vi.fn() }));
vi.mock("~/slack/lib/slack-client", () => ({
  sendDm: vi.fn(),
  postMessage: vi.fn(),
  postBlocks: vi.fn(),
  uploadFileToThread: vi.fn(),
  slackConfigured: vi.fn(() => true),
}));
vi.mock("~/lib/s3", () => ({ getObjectBytes: vi.fn() }));
vi.mock("~/lib/app-env", () => ({ getAppEnv: vi.fn(() => "prod") }));

import { prisma } from "~/lib/db.server";
import { sendEmail } from "~/lib/gmail";
import { getSender, noteSenderHealth } from "~/lib/gmail-integration";
import { sendDm, postMessage, postBlocks, uploadFileToThread } from "~/slack/lib/slack-client";
import { getObjectBytes } from "~/lib/s3";
import { getAppEnv } from "~/lib/app-env";
import { enqueueOutbound, runOutboundDrain } from "~/lib/outbound.server";

const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const anyFn = (f: unknown) => f as unknown as ReturnType<typeof vi.fn>;

function emailRow(o: Record<string, unknown> = {}) {
  return {
    id: "om1",
    channel: "email",
    purpose: "General",
    senderId: null,
    target: "a@b.com",
    recipientUserId: "u1",
    notificationId: "n1",
    subject: "Subj",
    bodyHtml: "<p>hi</p>",
    bodyText: null,
    slackText: null,
    ics: null,
    attachments: null,
    status: "Pending",
    attempts: 0,
    nextAttemptAt: new Date(0),
    lastError: null,
    sentAt: null,
    ...o,
  };
}

const ctx = () => ({ now: new Date(), lastSuccessAt: null, settings: {} as Record<string, number> });

function p2002() {
  // Duck-typed Prisma unique-violation (matches isUniqueViolation's code check)
  // without a value-import of the generated client.
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

beforeEach(() => {
  vi.clearAllMocks();
  anyFn(getAppEnv).mockReturnValue("prod");
  p.outboundMessage.updateMany.mockResolvedValue({ count: 1 });
  p.outboundMessage.update.mockResolvedValue({});
  p.outboundMessage.findMany.mockResolvedValue([{ id: "om1" }]);
  p.notification.update.mockResolvedValue({});
  p.gmailIntegration.findUnique.mockResolvedValue({ dailyCap: null });
  p.senderDailyUsage.findUnique.mockResolvedValue({ count: 0 });
  p.senderDailyUsage.upsert.mockResolvedValue({});
  anyFn(getSender).mockResolvedValue({ id: "g1", refreshToken: "rt", sendAsEmail: "from@x" });
  anyFn(sendEmail).mockResolvedValue({});
  anyFn(noteSenderHealth).mockResolvedValue(undefined);
});

describe("enqueueOutbound", () => {
  it("creates a row and returns its id", async () => {
    p.outboundMessage.create.mockResolvedValue({ id: "om1" });
    const r = await enqueueOutbound({ channel: "email", target: "a@b.com", dedupKey: "k1" });
    expect(r).toEqual({ id: "om1", deduped: false });
    expect(p.outboundMessage.create).toHaveBeenCalledTimes(1);
  });

  it("treats a unique-violation on a keyed send as a dedup no-op", async () => {
    p.outboundMessage.create.mockRejectedValue(p2002());
    const r = await enqueueOutbound({ channel: "email", target: "a@b.com", dedupKey: "k1" });
    expect(r).toEqual({ id: null, deduped: true });
  });

  it("rethrows a non-unique error", async () => {
    p.outboundMessage.create.mockRejectedValue(new Error("db down"));
    await expect(
      enqueueOutbound({ channel: "email", target: "a@b.com", dedupKey: "k1" }),
    ).rejects.toThrow("db down");
  });
});

describe("runOutboundDrain — email", () => {
  it("sends, marks Sent, increments usage, and stamps the notification", async () => {
    p.outboundMessage.findUnique.mockResolvedValue(emailRow());
    const res = await runOutboundDrain(ctx());

    expect(res.items).toBe(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@b.com", from: "from@x", subject: "Subj" }),
    );
    expect(p.senderDailyUsage.upsert).toHaveBeenCalledTimes(1);
    expect(p.outboundMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "Sent" }) }),
    );
    expect(p.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "n1" },
        data: expect.objectContaining({ emailedAt: expect.any(Date) }),
      }),
    );
  });

  it("defers over-cap sends to the next UTC day without sending", async () => {
    p.outboundMessage.findUnique.mockResolvedValue(emailRow());
    p.gmailIntegration.findUnique.mockResolvedValue({ dailyCap: 5 });
    p.senderDailyUsage.findUnique.mockResolvedValue({ count: 5 });

    const res = await runOutboundDrain(ctx());

    expect(res.items).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    const call = p.outboundMessage.update.mock.calls[0][0];
    expect(call.data.status).toBe("Pending");
    expect(call.data.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("backs off a transient failure (Pending, attempts++)", async () => {
    p.outboundMessage.findUnique.mockResolvedValue(emailRow({ attempts: 0 }));
    anyFn(sendEmail).mockRejectedValue(new Error("gmail 429"));

    const res = await runOutboundDrain(ctx());

    expect(res.items).toBe(0);
    expect(noteSenderHealth).toHaveBeenCalledWith("g1", "gmail 429");
    const call = p.outboundMessage.update.mock.calls[0][0];
    expect(call.data.status).toBe("Pending");
    expect(call.data.attempts).toBe(1);
    expect(call.data.lastError).toContain("gmail 429");
  });

  it("dead-letters once attempts reach the cap", async () => {
    p.outboundMessage.findUnique.mockResolvedValue(emailRow({ attempts: 5 }));
    anyFn(sendEmail).mockRejectedValue(new Error("still failing"));

    await runOutboundDrain(ctx());

    expect(p.outboundMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "Dead", attempts: 6 }) }),
    );
  });

  it("skips a row it loses the CAS claim on", async () => {
    p.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
    p.outboundMessage.findUnique.mockResolvedValue(emailRow());

    const res = await runOutboundDrain(ctx());

    expect(res.items).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(p.outboundMessage.findUnique).not.toHaveBeenCalled();
  });
});

describe("runOutboundDrain — slack safety", () => {
  it("cancels a slack row when sends are not allowed (non-prod)", async () => {
    anyFn(getAppEnv).mockReturnValue("staging");
    p.outboundMessage.findUnique.mockResolvedValue(
      emailRow({ channel: "slack_dm", target: "U123", slackText: "ping", notificationId: null }),
    );

    await runOutboundDrain(ctx());

    expect(sendDm).not.toHaveBeenCalled();
    expect(p.outboundMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "Canceled" }) }),
    );
  });

  it("posts a slack channel message in prod", async () => {
    anyFn(getAppEnv).mockReturnValue("prod");
    p.outboundMessage.findUnique.mockResolvedValue(
      emailRow({ channel: "slack_channel", target: "C123", slackText: "standup!", notificationId: null }),
    );

    const res = await runOutboundDrain(ctx());

    expect(res.items).toBe(1);
    expect(postMessage).toHaveBeenCalledWith("C123", "standup!");
  });

  describe("slack_channel with blocks", () => {
    const blocks = [{ type: "section" }];
    const blockRow = (o: Record<string, unknown> = {}) =>
      emailRow({
        channel: "slack_channel",
        target: "C123",
        slackText: "New: Thing",
        notificationId: null,
        slackBlocks: blocks,
        slackFileKey: null,
        slackTs: null,
        ...o,
      });

    beforeEach(() => {
      anyFn(postBlocks).mockResolvedValue({ ts: "111.222" });
      anyFn(getObjectBytes).mockResolvedValue({ body: Buffer.from("mp4") });
    });

    it("posts blocks, saves the ts right away, and skips the upload without a file key", async () => {
      p.outboundMessage.findUnique.mockResolvedValue(blockRow());
      await runOutboundDrain(ctx());
      expect(postBlocks).toHaveBeenCalledWith("C123", blocks, "New: Thing");
      expect(postMessage).not.toHaveBeenCalled();
      expect(p.outboundMessage.update).toHaveBeenCalledWith({
        where: { id: "om1" },
        data: { slackTs: "111.222" },
      });
      expect(uploadFileToThread).not.toHaveBeenCalled();
    });

    it("uploads the S3 file into the thread of the new post", async () => {
      p.outboundMessage.findUnique.mockResolvedValue(
        blockRow({ slackFileKey: "release-notes/uploads/demo.mp4" }),
      );
      await runOutboundDrain(ctx());
      expect(getObjectBytes).toHaveBeenCalledWith("release-notes/uploads/demo.mp4");
      expect(uploadFileToThread).toHaveBeenCalledWith(
        "C123",
        "111.222",
        Buffer.from("mp4"),
        "demo.mp4",
        "New: Thing",
      );
    });

    it("on retry with a saved ts, retries only the upload and never reposts", async () => {
      p.outboundMessage.findUnique.mockResolvedValue(
        blockRow({ slackTs: "111.222", slackFileKey: "release-notes/uploads/demo.mp4", attempts: 1 }),
      );
      const res = await runOutboundDrain(ctx());
      expect(res.items).toBe(1);
      expect(postBlocks).not.toHaveBeenCalled();
      expect(uploadFileToThread).toHaveBeenCalledWith(
        "C123",
        "111.222",
        expect.any(Buffer),
        "demo.mp4",
        "New: Thing",
      );
    });

    it("keeps the ts and schedules a retry when the upload fails", async () => {
      p.outboundMessage.findUnique.mockResolvedValue(
        blockRow({ slackFileKey: "release-notes/uploads/demo.mp4" }),
      );
      anyFn(uploadFileToThread).mockRejectedValue(new Error("files:write missing"));
      await runOutboundDrain(ctx());
      expect(p.outboundMessage.update).toHaveBeenCalledWith({
        where: { id: "om1" },
        data: { slackTs: "111.222" },
      });
      expect(p.outboundMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "Pending", lastError: "files:write missing" }),
        }),
      );
    });

    it("cancels outside prod without posting", async () => {
      anyFn(getAppEnv).mockReturnValue("staging");
      p.outboundMessage.findUnique.mockResolvedValue(blockRow());
      await runOutboundDrain(ctx());
      expect(postBlocks).not.toHaveBeenCalled();
    });
  });
});
