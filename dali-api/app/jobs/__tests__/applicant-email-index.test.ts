import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    mailAccount: { findFirst: vi.fn(), update: vi.fn() },
    gmailIntegration: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    mailMessageIndex: { findMany: vi.fn(), createMany: vi.fn(), aggregate: vi.fn() },
    userEmail: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

const { MockMailboxError } = vi.hoisted(() => {
  class MockMailboxError extends Error {
    constructor(message: string) {
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
  }));
});

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
    db.mailMessageIndex.findMany.mockResolvedValue([{ gmailMessageId: "m1" }]);

    const result = await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });

    expect(getMessageMetadata).not.toHaveBeenCalled();
    expect(db.mailMessageIndex.createMany).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });
});
