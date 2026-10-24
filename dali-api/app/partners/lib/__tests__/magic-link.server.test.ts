import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: { findFirst: vi.fn(), create: vi.fn() },
    dALIMember: { findUnique: vi.fn() },
    oneTimeToken: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => null) }));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(),
  drainNow: vi.fn(),
}));
const mockFlagOn = vi.hoisted(() => vi.fn());
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabledForEveryone: mockFlagOn }));
const mockSignInMagicLink = vi.hoisted(() => vi.fn());
vi.mock("~/lib/betterauth.server", () => ({
  auth: { api: { signInMagicLink: mockSignInMagicLink } },
}));
vi.mock("../partner-emails.server", () => ({
  sendMemberEmailConflictEmail: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { checkRateLimit } from "~/lib/rate-limit";
import { enqueueOutbound } from "~/lib/outbound.server";
import { sendMemberEmailConflictEmail } from "../partner-emails.server";
import {
  classifyPartnerEmail,
  consumePartnerMagicLink,
  hashToken,
  issuePartnerMagicLink,
} from "../magic-link.server";

const mockPrisma = prisma as any;
const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;
const req = () => new Request("http://localhost/partner/login", { method: "POST" });

beforeEach(() => {
  vi.resetAllMocks();
  (checkRateLimit as any).mockReturnValue(null);
  mockFlagOn.mockResolvedValue(false);
  mockEnqueue.mockResolvedValue({ id: "om-x", deduped: false });
  mockPrisma.user.findFirst.mockResolvedValue(null);
  mockPrisma.dALIMember.findUnique.mockResolvedValue(null);
  mockPrisma.user.create.mockResolvedValue({ id: "new-user" });
  mockPrisma.oneTimeToken.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.oneTimeToken.create.mockResolvedValue({ id: "tok1" });
});

describe("classifyPartnerEmail", () => {
  it("flags @dali.dartmouth.edu addresses without a DB lookup", async () => {
    expect(await classifyPartnerEmail("kiran@dali.dartmouth.edu")).toEqual({
      kind: "member-conflict",
    });
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("flags users carrying member or Dartmouth identity", async () => {
    for (const marker of [
      { daliEmail: "x@dali.dartmouth.edu" },
      { dartmouthEmail: "x@dartmouth.edu" },
      { netId: "f00" },
    ]) {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: "u1",
        daliEmail: null,
        dartmouthEmail: null,
        netId: null,
        ...marker,
      });
      expect(await classifyPartnerEmail("pat@example.com")).toEqual({
        kind: "member-conflict",
      });
    }
  });

  it("flags users with a DALIMember row even without email markers", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u1",
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
    });
    mockPrisma.dALIMember.findUnique.mockResolvedValue({ id: "m1" });
    expect(await classifyPartnerEmail("pat@example.com")).toEqual({
      kind: "member-conflict",
    });
  });

  it("returns existing for a plain personal-email user", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u1",
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
    });
    expect(await classifyPartnerEmail("pat@example.com")).toEqual({
      kind: "existing",
      userId: "u1",
    });
  });

  it("returns new when no user matches", async () => {
    expect(await classifyPartnerEmail("pat@example.com")).toEqual({ kind: "new" });
  });
});

describe("issuePartnerMagicLink with BetterAuth on", () => {
  beforeEach(() => {
    mockFlagOn.mockResolvedValue(true);
    mockSignInMagicLink.mockResolvedValue({ status: true });
  });

  it("sends a BetterAuth magic link to the normalized email and writes no legacy token", async () => {
    const request = req();
    const result = await issuePartnerMagicLink(" Pat@Example.com ", request);
    expect(result).toEqual({ ok: true });
    expect(mockSignInMagicLink).toHaveBeenCalledWith({
      body: { email: "pat@example.com", callbackURL: "/welcome?door=partner" },
      headers: request.headers,
    });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.oneTimeToken.create).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("still sends the conflict email instead of a link for member addresses", async () => {
    const result = await issuePartnerMagicLink("ada@dali.dartmouth.edu", req());
    expect(result).toEqual({ ok: true });
    expect(sendMemberEmailConflictEmail).toHaveBeenCalledWith("ada@dali.dartmouth.edu");
    expect(mockSignInMagicLink).not.toHaveBeenCalled();
  });

  it("returns the same neutral result when BetterAuth refuses the send", async () => {
    mockSignInMagicLink.mockRejectedValue(new Error("FORBIDDEN"));
    expect(await issuePartnerMagicLink("pat@example.com", req())).toEqual({ ok: true });
  });

  it("keeps the rate limits in front of BetterAuth", async () => {
    const limited = new Response(null, { status: 429 });
    (checkRateLimit as any).mockReturnValue(limited);
    const result = await issuePartnerMagicLink("pat@example.com", req());
    expect("rateLimited" in result && result.rateLimited).toBe(limited);
    expect(mockSignInMagicLink).not.toHaveBeenCalled();
  });
});

describe("issuePartnerMagicLink", () => {
  it("returns the rate-limit response when limited", async () => {
    const limited = new Response(null, { status: 429 });
    (checkRateLimit as any).mockReturnValue(limited);
    const result = await issuePartnerMagicLink("pat@example.com", req());
    expect("rateLimited" in result && result.rateLimited).toBe(limited);
    expect(mockPrisma.oneTimeToken.create).not.toHaveBeenCalled();
  });

  it("sends a conflict email and no token for member addresses", async () => {
    const result = await issuePartnerMagicLink("Kiran@dali.dartmouth.edu", req());
    expect(result).toEqual({ ok: true });
    expect(sendMemberEmailConflictEmail).toHaveBeenCalledWith(
      "kiran@dali.dartmouth.edu",
    );
    expect(mockPrisma.oneTimeToken.create).not.toHaveBeenCalled();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("creates a user for a new email, invalidates prior tokens, stores only the hash", async () => {
    const result = await issuePartnerMagicLink("  Pat@Example.com ", req());
    expect(result).toEqual({ ok: true });
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: { personalEmail: "pat@example.com", firstName: "", lastName: "" },
      select: { id: true },
    });
    expect(mockPrisma.oneTimeToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "new-user", purpose: "PartnerMagicLink", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    const createArg = mockPrisma.oneTimeToken.create.mock.calls[0][0];
    expect(createArg.data.purpose).toBe("PartnerMagicLink");
    // Hash at rest: the stored value must not be the raw token in the link. The
    // magic link is enqueued to the outbox; the raw token lives in its bodyHtml.
    const bodyHtml: string = mockEnqueue.mock.calls[0][0].bodyHtml;
    const raw = bodyHtml.match(/token=([^"&\s]+)/)![1];
    expect(createArg.data.tokenHash).toBe(hashToken(raw));
    expect(createArg.data.tokenHash).not.toBe(raw);
  });

  it("reuses the existing user for a returning partner email", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u9",
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
    });
    await issuePartnerMagicLink("pat@example.com", req());
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.oneTimeToken.create.mock.calls[0][0].data.userId).toBe("u9");
  });
});

describe("consumePartnerMagicLink", () => {
  it("returns the userId when the atomic consume wins", async () => {
    mockPrisma.oneTimeToken.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.oneTimeToken.findUnique.mockResolvedValue({ userId: "u1" });
    expect(await consumePartnerMagicLink("raw-token")).toBe("u1");
    const where = mockPrisma.oneTimeToken.updateMany.mock.calls[0][0].where;
    expect(where.usedAt).toBe(null);
    expect(where.expiresAt).toEqual({ gt: expect.any(Date) });
  });

  it("returns null when the token was already used or expired", async () => {
    mockPrisma.oneTimeToken.updateMany.mockResolvedValue({ count: 0 });
    expect(await consumePartnerMagicLink("raw-token")).toBe(null);
    expect(mockPrisma.oneTimeToken.findUnique).not.toHaveBeenCalled();
  });
});
