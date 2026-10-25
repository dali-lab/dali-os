import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: { findFirst: vi.fn(), create: vi.fn() },
    dALIMember: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => null) }));
const mockSignInMagicLink = vi.hoisted(() => vi.fn());
vi.mock("~/lib/betterauth.server", () => ({
  auth: { api: { signInMagicLink: mockSignInMagicLink } },
}));
vi.mock("../partner-emails.server", () => ({
  sendMemberEmailConflictEmail: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { checkRateLimit } from "~/lib/rate-limit";
import { sendMemberEmailConflictEmail } from "../partner-emails.server";
import {
  classifyPartnerEmail,
  issuePartnerMagicLink,
} from "../magic-link.server";

const mockPrisma = prisma as any;
const req = () => new Request("http://localhost/partner/login", { method: "POST" });

beforeEach(() => {
  vi.resetAllMocks();
  (checkRateLimit as any).mockReturnValue(null);
  mockPrisma.user.findFirst.mockResolvedValue(null);
  mockPrisma.dALIMember.findUnique.mockResolvedValue(null);
  mockPrisma.user.create.mockResolvedValue({ id: "new-user" });
});

describe("classifyPartnerEmail", () => {
  it("flags @dali.dartmouth.edu addresses without a DB lookup", async () => {
    expect(await classifyPartnerEmail("ada@dali.dartmouth.edu")).toEqual({
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

describe("issuePartnerMagicLink", () => {
  beforeEach(() => {
    mockSignInMagicLink.mockResolvedValue({ status: true });
  });

  it("sends a BetterAuth magic link to the normalized email", async () => {
    const request = req();
    const result = await issuePartnerMagicLink(" Pat@Example.com ", request);
    expect(result).toEqual({ ok: true });
    expect(mockSignInMagicLink).toHaveBeenCalledWith({
      body: { email: "pat@example.com", callbackURL: "/welcome?door=partner" },
      headers: request.headers,
    });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
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
