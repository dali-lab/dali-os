import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { mailAccount: { findFirst: vi.fn() } },
}));
vi.mock("~/lib/gmail-integration", () => ({
  getMailboxReader: vi.fn(),
  noteSenderHealth: vi.fn(),
}));
vi.mock("~/lib/google-oauth", () => ({
  refreshGoogleToken: vi.fn(),
  GoogleOAuthError: class GoogleOAuthError extends Error {},
}));
vi.mock("~/email/lib/gmail-mailbox.server", () => ({
  getMailboxToken: vi.fn(),
  MailboxError: class MailboxError extends Error {},
}));

import { prisma } from "~/lib/db";
import { getMailboxReader } from "~/lib/gmail-integration";
import { refreshGoogleToken } from "~/lib/google-oauth";
import { getMailboxToken } from "~/email/lib/gmail-mailbox.server";
import { getSharedInboxToken } from "~/email/lib/mail-index.server";

const db = prisma as unknown as { mailAccount: Record<string, ReturnType<typeof vi.fn>> };
const ADDRESS = "applications@dali.dartmouth.edu";
const connection = { id: "conn1", userId: "u1", oauthTokens: "sealed", syncError: null };

beforeEach(() => {
  vi.clearAllMocks();
  db.mailAccount.findFirst.mockResolvedValue({ id: "acc1", address: ADDRESS, connections: [connection] });
  vi.mocked(getMailboxReader).mockResolvedValue(null);
  vi.mocked(getMailboxToken).mockResolvedValue("member-token");
  vi.mocked(refreshGoogleToken).mockResolvedValue({ access_token: "reader-token", expires_in: 3600 } as any);
});

describe("getSharedInboxToken", () => {
  it("prefers the Hiring integration when it has inbox read access", async () => {
    vi.mocked(getMailboxReader).mockResolvedValue({ id: "gi1", refreshToken: "rt" });
    const got = await getSharedInboxToken(ADDRESS);
    expect(got.token).toBe("reader-token");
    expect(got.source).toBe("the Hiring Gmail integration");
    expect(getMailboxToken).not.toHaveBeenCalled();
  });

  it("reuses the minted access token until it nears expiry", async () => {
    vi.mocked(getMailboxReader).mockResolvedValue({ id: "gi-cached", refreshToken: "rt" });
    await getSharedInboxToken(ADDRESS);
    await getSharedInboxToken(ADDRESS);
    expect(refreshGoogleToken).toHaveBeenCalledTimes(1);
  });

  it("falls back to a member's connection without read access", async () => {
    const got = await getSharedInboxToken(ADDRESS);
    expect(got.token).toBe("member-token");
    expect(got.source).toBe("u1's connection");
  });

  it("explains both missing paths when nothing can read the inbox", async () => {
    db.mailAccount.findFirst.mockResolvedValue({ id: "acc1", address: ADDRESS, connections: [] });
    await expect(getSharedInboxToken(ADDRESS)).rejects.toThrow(/Nobody has connected .* read access/);
  });
});
