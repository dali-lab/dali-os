import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    mailAccount: { findFirst: vi.fn(), update: vi.fn() },
    gmailIntegration: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    mailMessageIndex: { findMany: vi.fn(), createMany: vi.fn(), aggregate: vi.fn() },
    userEmail: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    partnerContact: { findMany: vi.fn() },
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
vi.mock("~/lib/google-oauth", () => ({
  refreshGoogleToken: vi.fn(),
  GoogleOAuthError: class GoogleOAuthError extends Error {},
  GMAIL_READONLY_SCOPE: "https://www.googleapis.com/auth/gmail.readonly",
}));

import { prisma } from "~/lib/db";
import { getMailboxToken, getMessageMetadata, listMessageIds } from "~/email/lib/gmail-mailbox.server";
import { refreshGoogleToken } from "~/lib/google-oauth";
import { runSharedInboxIndex, runPartnerEmailIndex } from "~/jobs/shared-inbox-index.server";
import { runApplicantEmailIndex } from "~/jobs/applicant-email-index.server";
import { APPLICATIONS_FROM_EMAIL, PARTNERS_FROM_EMAIL } from "~/lib/app-env";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const NOW = new Date("2026-07-15T12:00:00Z");
const SETTINGS = { backfillDays: 365, maxMessagesPerRun: 100, overlapHours: 24 };

function account(address: string, overrides: Partial<{ id: string; indexBackfilledAt: Date | null }> = {}) {
  return { id: "acc1", address, indexBackfilledAt: null, ...overrides };
}

function connectedAccount(address: string, overrides: Partial<{ indexBackfilledAt: Date | null }> = {}) {
  db.mailAccount.findFirst.mockResolvedValue({
    ...account(address, overrides),
    connections: [{ id: "conn1", userId: "u1", oauthTokens: "sealed", syncError: null }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.mailAccount.findFirst.mockResolvedValue(null);
  db.mailAccount.update.mockResolvedValue({});
  db.gmailIntegration.findFirst.mockResolvedValue(null);
  db.mailMessageIndex.findMany.mockResolvedValue([]);
  db.mailMessageIndex.createMany.mockResolvedValue({ count: 0 });
  db.mailMessageIndex.aggregate.mockResolvedValue({ _max: { sentAt: null } });
  db.userEmail.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
  db.partnerContact.findMany.mockResolvedValue([]);
  vi.mocked(getMailboxToken).mockResolvedValue("token-abc");
  vi.mocked(listMessageIds).mockResolvedValue({ messages: [], nextPageToken: null });
  vi.mocked(getMessageMetadata).mockImplementation(async (_token, id) => ({
    id,
    threadId: `t-${id}`,
    labelIds: [],
    date: "2026-01-01T00:00:00.000Z",
    from: "ada@x.com",
    to: APPLICATIONS_FROM_EMAIL,
    cc: "",
    subject: "Hi",
  }));
});

describe("runSharedInboxIndex", () => {
  it("notes and skips when there is no Shared inbox for the address", async () => {
    const result = await runSharedInboxIndex(PARTNERS_FROM_EMAIL, { now: NOW, lastSuccessAt: null, settings: SETTINGS });
    expect(result.items).toBe(0);
    expect(result.note).toContain("No Shared inbox");
    expect(listMessageIds).not.toHaveBeenCalled();
  });

  it("borrows the Partners Gmail integration and labels the source accordingly", async () => {
    connectedAccount(PARTNERS_FROM_EMAIL);
    db.gmailIntegration.findFirst.mockResolvedValue({ id: "gi1", oauthTokens: "sealed-reader" });
    vi.mocked(refreshGoogleToken).mockResolvedValue({ access_token: "reader-token", expires_in: 3600 } as any);
    vi.mocked(listMessageIds).mockResolvedValue({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: null });

    const result = await runSharedInboxIndex(
      PARTNERS_FROM_EMAIL,
      { now: NOW, lastSuccessAt: null, settings: SETTINGS },
      { purpose: "Partners" },
    );

    expect(db.gmailIntegration.findFirst.mock.calls[0][0].where.purpose).toBe("Partners");
    expect(getMailboxToken).not.toHaveBeenCalled();
    expect(result.note).toContain("the Partners Gmail integration");
    expect(result.note).not.toContain("Hiring");
  });

  it("falls back to a member connection and indexes via the given address, independent of purpose", async () => {
    connectedAccount(PARTNERS_FROM_EMAIL);
    vi.mocked(listMessageIds).mockResolvedValue({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: null });
    vi.mocked(getMessageMetadata).mockResolvedValue({
      id: "m1",
      threadId: "t1",
      labelIds: [],
      date: "2026-01-01T00:00:00.000Z",
      from: "partner@acme.com",
      to: PARTNERS_FROM_EMAIL,
      cc: "",
      subject: "Hello",
    });

    const result = await runSharedInboxIndex(
      PARTNERS_FROM_EMAIL,
      { now: NOW, lastSuccessAt: null, settings: SETTINGS },
      { purpose: "Partners" },
    );

    expect(result.note).toContain("via u1's connection");
    const data = db.mailMessageIndex.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({ accountId: "acc1", gmailMessageId: "m1" });
  });

  it("queries the full backfillDays window on first run, for either address", async () => {
    connectedAccount(APPLICATIONS_FROM_EMAIL);
    await runSharedInboxIndex(APPLICATIONS_FROM_EMAIL, { now: NOW, lastSuccessAt: null, settings: SETTINGS });

    const query: string = vi.mocked(listMessageIds).mock.calls[0][1].query;
    const expectedAfter = Math.floor((NOW.getTime() - 365 * 86_400_000) / 1000);
    expect(query).toContain(`after:${expectedAfter}`);
  });

  it("stamps indexBackfilledAt once the backlog is fully drained in one run", async () => {
    connectedAccount(PARTNERS_FROM_EMAIL, { indexBackfilledAt: null });
    vi.mocked(listMessageIds).mockResolvedValue({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: null });

    await runSharedInboxIndex(
      PARTNERS_FROM_EMAIL,
      { now: NOW, lastSuccessAt: null, settings: SETTINGS },
      { purpose: "Partners" },
    );

    expect(db.mailAccount.update).toHaveBeenCalledWith({
      where: { id: "acc1" },
      data: { indexBackfilledAt: NOW },
    });
  });

  it("notes a MailboxError from the token fetch instead of throwing, for a non-Hiring purpose too", async () => {
    db.mailAccount.findFirst.mockResolvedValue({
      ...account(PARTNERS_FROM_EMAIL),
      connections: [],
    });

    const result = await runSharedInboxIndex(
      PARTNERS_FROM_EMAIL,
      { now: NOW, lastSuccessAt: null, settings: SETTINGS },
      { purpose: "Partners" },
    );

    expect(result.items).toBe(0);
    expect(result.note).toContain("Partners Gmail integration has no inbox read access");
    expect(result.note).not.toContain("Hiring");
  });
});

describe("runApplicantEmailIndex", () => {
  it("delegates to runSharedInboxIndex with the applications@ address and the default (Hiring) purpose", async () => {
    connectedAccount(APPLICATIONS_FROM_EMAIL);
    await runApplicantEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });
    expect(db.mailAccount.findFirst.mock.calls[0][0].where.address).toBe(APPLICATIONS_FROM_EMAIL);
  });
});

describe("runPartnerEmailIndex", () => {
  it("delegates to runSharedInboxIndex with the partners@ address and the Partners purpose", async () => {
    connectedAccount(PARTNERS_FROM_EMAIL);
    await runPartnerEmailIndex({ now: NOW, lastSuccessAt: null, settings: SETTINGS });
    expect(db.mailAccount.findFirst.mock.calls[0][0].where.address).toBe(PARTNERS_FROM_EMAIL);
  });
});
