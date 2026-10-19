import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    mailAccount: { findFirst: vi.fn(), update: vi.fn() },
    gmailIntegration: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    mailMessageIndex: { findMany: vi.fn(), createMany: vi.fn(), aggregate: vi.fn(), updateMany: vi.fn() },
    userEmail: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

const { MockMailboxError } = vi.hoisted(() => {
  class MockMailboxError extends Error {
    constructor(
      message: string,
      public readonly status?: number,
    ) {
      super(message);
      this.name = "MailboxError";
    }
  }
  return { MockMailboxError };
});

vi.mock("~/email/lib/gmail-mailbox.server", () => ({
  getMailboxToken: vi.fn(),
  listMessageIds: vi.fn(),
  getMessageMetadata: vi.fn(),
  MailboxError: MockMailboxError,
}));

import { prisma } from "~/lib/db";
import { getMailboxToken, getMessageMetadata, listMessageIds } from "~/email/lib/gmail-mailbox.server";
import { runApplicantEmailIndex } from "~/jobs/applicant-email-index.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const NOW = new Date("2026-07-15T12:00:00Z");

const ADDRESS = "applications@dali.dartmouth.edu";
const SETTINGS = { backfillDays: 365, maxMessagesPerRun: 100, overlapHours: 24 };

function account(overrides: Partial<{ id: string; indexBackfilledAt: Date | null }> = {}) {
  return { id: "acc1", address: ADDRESS, indexBackfilledAt: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.mailAccount.findFirst.mockResolvedValue(null);
  db.mailAccount.update.mockResolvedValue({});
  db.mailMessageIndex.findMany.mockResolvedValue([]);
  db.mailMessageIndex.createMany.mockResolvedValue({ count: 0 });
  db.mailMessageIndex.aggregate.mockResolvedValue({ _max: { sentAt: null } });
  db.userEmail.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
  vi.mocked(getMailboxToken).mockResolvedValue("token-abc");
  vi.mocked(listMessageIds).mockResolvedValue({ messages: [], nextPageToken: null });
  vi.mocked(getMessageMetadata).mockImplementation(async (_token, id) => ({
    id,
    threadId: `t-${id}`,
    labelIds: [],
    date: "2026-01-01T00:00:00.000Z",
    from: "ada@x.com",
    to: ADDRESS,
    cc: "",
    subject: "Hi",
    autoSubmitted: "",
    precedence: "",
    xAutoreply: "",
  }));
});

type FindManyArgs = { where: { autoReply?: null; gmailMessageId?: { in: string[] } } };

// The job reads the index twice: which listed ids already exist, and which
// inbound rows still need an auto-reply check.
function indexRows(opts: { existing?: string[]; unchecked?: { id: string; gmailMessageId: string }[] }) {
  db.mailMessageIndex.findMany.mockImplementation(async (args: FindManyArgs) => {
    if (args.where.autoReply === null) return opts.unchecked ?? [];
    return (opts.existing ?? []).map((gmailMessageId) => ({ gmailMessageId }));
  });
}

describe("runApplicantEmailIndex", () => {
  it("notes and skips when there is no Shared inbox for the address", async () => {
    db.mailAccount.findFirst.mockResolvedValue(null);
    const result = await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });
    expect(result.items).toBe(0);
    expect(result.note).toContain("No Shared inbox");
    expect(listMessageIds).not.toHaveBeenCalled();
  });

  it("notes and skips when nobody has connected the inbox", async () => {
    db.mailAccount.findFirst.mockResolvedValue({ ...account(), connections: [] });
    const result = await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });
    expect(result.items).toBe(0);
    expect(result.note).toContain("Nobody has connected");
    expect(listMessageIds).not.toHaveBeenCalled();
  });

  it("notes a MailboxError from the token fetch instead of throwing", async () => {
    db.mailAccount.findFirst.mockResolvedValue({
      ...account(),
      connections: [{ id: "conn1", userId: "u1", oauthTokens: "sealed", syncError: null }],
    });
    vi.mocked(getMailboxToken).mockRejectedValue(new MockMailboxError("Sign-in expired. Reconnect this account."));

    const result = await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });
    expect(result.items).toBe(0);
    expect(result.note).toBe("Sign-in expired. Reconnect this account.");
  });

  function connectedAccount(overrides: Partial<{ indexBackfilledAt: Date | null }> = {}) {
    db.mailAccount.findFirst.mockResolvedValue({
      ...account(overrides),
      connections: [{ id: "conn1", userId: "u1", oauthTokens: "sealed", syncError: null }],
    });
  }

  it("queries the full backfillDays window on first run", async () => {
    connectedAccount({ indexBackfilledAt: null });
    await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });

    const query: string = vi.mocked(listMessageIds).mock.calls[0][1].query;
    const expectedAfter = Math.floor((NOW.getTime() - 365 * 86_400_000) / 1000);
    expect(query).toContain(`after:${expectedAfter}`);
    expect(query).toContain("-in:chats");
  });

  it("queries only overlapHours past the newest indexed message once backfilled", async () => {
    connectedAccount({ indexBackfilledAt: NOW });
    const maxSentAt = new Date("2026-07-01T00:00:00Z");
    db.mailMessageIndex.aggregate.mockResolvedValue({ _max: { sentAt: maxSentAt } });

    await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });

    const query: string = vi.mocked(listMessageIds).mock.calls[0][1].query;
    const expectedAfter = Math.floor((maxSentAt.getTime() - 24 * 3_600_000) / 1000);
    expect(query).toContain(`after:${expectedAfter}`);
  });

  it("processes only the oldest maxMessagesPerRun ids when more are missing, and leaves indexBackfilledAt unset", async () => {
    connectedAccount({ indexBackfilledAt: null });
    // Gmail lists newest-first: ids are m1 (newest) .. m5 (oldest).
    const listed = ["m1", "m2", "m3", "m4", "m5"].map((id) => ({ id, threadId: `t-${id}` }));
    vi.mocked(listMessageIds).mockResolvedValue({ messages: listed, nextPageToken: null });

    const result = await runApplicantEmailIndex({
      now: NOW,
      lastSuccessAt: null,
      settings: { ...SETTINGS, maxMessagesPerRun: 2 },
    });

    const fetchedIds = vi.mocked(getMessageMetadata).mock.calls.map((c) => c[1]);
    expect(fetchedIds.sort()).toEqual(["m4", "m5"]); // the two oldest of the five missing
    expect(db.mailAccount.update).not.toHaveBeenCalled();
    expect(result.note).toContain("backfill remaining 3");
  });

  it("stamps indexBackfilledAt once the backlog is fully drained in one run", async () => {
    connectedAccount({ indexBackfilledAt: null });
    vi.mocked(listMessageIds).mockResolvedValue({
      messages: [{ id: "m1", threadId: "t1" }],
      nextPageToken: null,
    });

    const result = await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });

    expect(db.mailAccount.update).toHaveBeenCalledWith({
      where: { id: "acc1" },
      data: { indexBackfilledAt: NOW },
    });
    expect(result.note).toContain("backfill complete");
  });

  it("does not re-stamp indexBackfilledAt once already set", async () => {
    connectedAccount({ indexBackfilledAt: new Date("2026-01-01T00:00:00Z") });
    vi.mocked(listMessageIds).mockResolvedValue({
      messages: [{ id: "m1", threadId: "t1" }],
      nextPageToken: null,
    });

    await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });

    expect(db.mailAccount.update).not.toHaveBeenCalled();
  });

  it("creates nothing on a re-run where every listed id is already indexed", async () => {
    connectedAccount({ indexBackfilledAt: null });
    vi.mocked(listMessageIds).mockResolvedValue({
      messages: [{ id: "m1", threadId: "t1" }],
      nextPageToken: null,
    });
    indexRows({ existing: ["m1"] });

    const result = await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });

    expect(getMessageMetadata).not.toHaveBeenCalled();
    expect(db.mailMessageIndex.createMany).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  describe("auto-reply classification", () => {
    function metaFor(id: string, extra: Record<string, unknown> = {}) {
      return {
        id,
        threadId: `t-${id}`,
        labelIds: [] as string[],
        date: "2026-01-01T00:00:00.000Z",
        from: "ada@x.com",
        to: ADDRESS,
        cc: "",
        subject: "Hi",
        autoSubmitted: "",
        precedence: "",
        xAutoreply: "",
        ...extra,
      };
    }

    it("flags new inbound auto-replies and stores false for ordinary mail", async () => {
      connectedAccount();
      vi.mocked(listMessageIds).mockResolvedValue({
        messages: [
          { id: "ooo", threadId: "t1" },
          { id: "real", threadId: "t2" },
        ],
        nextPageToken: null,
      });
      vi.mocked(getMessageMetadata).mockImplementation(async (_t, id) =>
        metaFor(id, id === "ooo" ? { autoSubmitted: "auto-replied" } : {}),
      );

      await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });

      const data = db.mailMessageIndex.createMany.mock.calls[0][0].data as { gmailMessageId: string; autoReply: boolean }[];
      expect(Object.fromEntries(data.map((d) => [d.gmailMessageId, d.autoReply]))).toEqual({ ooo: true, real: false });
    });

    it("stores false for outbound mail even when it carries auto headers", async () => {
      connectedAccount();
      vi.mocked(listMessageIds).mockResolvedValue({ messages: [{ id: "sent", threadId: "t1" }], nextPageToken: null });
      vi.mocked(getMessageMetadata).mockResolvedValue(
        metaFor("sent", { labelIds: ["SENT"], from: ADDRESS, to: "ada@x.com", autoSubmitted: "auto-generated" }),
      );

      await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });

      const data = db.mailMessageIndex.createMany.mock.calls[0][0].data;
      expect(data[0]).toMatchObject({ direction: "Outbound", autoReply: false });
    });

    it("checks unchecked inbound rows with the budget left after new mail", async () => {
      connectedAccount();
      vi.mocked(listMessageIds).mockResolvedValue({ messages: [{ id: "new", threadId: "t1" }], nextPageToken: null });
      indexRows({ unchecked: [] });

      await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: { ...SETTINGS, maxMessagesPerRun: 10 } });

      const recheck = db.mailMessageIndex.findMany.mock.calls
        .map((c) => c[0])
        .find((a: FindManyArgs) => a.where.autoReply === null);
      expect(recheck).toMatchObject({
        where: { accountId: "acc1", direction: "Inbound", autoReply: null },
        take: 9,
      });
    });

    it("skips the check when new mail used the whole budget", async () => {
      connectedAccount();
      vi.mocked(listMessageIds).mockResolvedValue({
        messages: [
          { id: "a", threadId: "t1" },
          { id: "b", threadId: "t2" },
        ],
        nextPageToken: null,
      });

      await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: { ...SETTINGS, maxMessagesPerRun: 2 } });

      const recheck = db.mailMessageIndex.findMany.mock.calls.find((c) => c[0].where.autoReply === null);
      expect(recheck).toBeUndefined();
      expect(db.mailMessageIndex.updateMany).not.toHaveBeenCalled();
    });

    it("sets autoReply on unchecked rows from their headers and reports the count", async () => {
      connectedAccount();
      indexRows({
        unchecked: [
          { id: "r1", gmailMessageId: "g-ooo" },
          { id: "r2", gmailMessageId: "g-real" },
          { id: "r3", gmailMessageId: "g-bounce" },
        ],
      });
      vi.mocked(getMessageMetadata).mockImplementation(async (_t, id) => {
        if (id === "g-ooo") return metaFor(id, { xAutoreply: "yes" });
        if (id === "g-bounce") return metaFor(id, { from: "MAILER-DAEMON@googlemail.com" });
        return metaFor(id);
      });

      const result = await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });

      expect(db.mailMessageIndex.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["r1", "r3"] } },
        data: { autoReply: true },
      });
      expect(db.mailMessageIndex.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["r2"] } },
        data: { autoReply: false },
      });
      expect(result.note).toContain("checked 3 for auto-replies");
    });

    it("settles a row whose message was deleted from Gmail as not an auto-reply", async () => {
      connectedAccount();
      indexRows({ unchecked: [{ id: "r1", gmailMessageId: "gone" }] });
      vi.mocked(getMessageMetadata).mockRejectedValue(new MockMailboxError("Gmail request failed (404)", 404));

      await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });

      expect(db.mailMessageIndex.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["r1"] } },
        data: { autoReply: false },
      });
    });

    it("leaves rows unchecked and throws on other Gmail errors, so the next run retries", async () => {
      connectedAccount();
      indexRows({ unchecked: [{ id: "r1", gmailMessageId: "g1" }] });
      vi.mocked(getMessageMetadata).mockRejectedValue(new MockMailboxError("Gmail request failed (500)", 500));

      await expect(
        runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS }),
      ).rejects.toThrow("500");
      expect(db.mailMessageIndex.updateMany).not.toHaveBeenCalled();
    });

    it("omits the auto-reply part of the note when nothing needed checking", async () => {
      connectedAccount();
      const result = await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });
      expect(result.note).not.toContain("auto-replies");
    });
  });
});
