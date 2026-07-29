import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    dALIMember: { findUnique: vi.fn() },
    partnerUser: { findUnique: vi.fn(), create: vi.fn() },
    partnerInvite: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("../partner-emails.server", () => ({
  sendPartnerInviteEmail: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { sendPartnerInviteEmail } from "../partner-emails.server";
import {
  acceptPartnerInvite,
  createPartnerInvite,
  revokePartnerInvite,
} from "../invites.server";

const mockPrisma = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  (sendPartnerInviteEmail as any).mockResolvedValue({ ok: true });
  mockPrisma.user.findFirst.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockResolvedValue({ firstName: "Ada", lastName: "L" });
  mockPrisma.user.create.mockResolvedValue({ id: "new-user" });
  mockPrisma.dALIMember.findUnique.mockResolvedValue(null);
  mockPrisma.partnerUser.findUnique.mockResolvedValue(null);
  mockPrisma.partnerUser.create.mockResolvedValue({ id: "pu1" });
  mockPrisma.partnerInvite.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.partnerInvite.create.mockResolvedValue({
    id: "inv1",
    partnerOrg: { name: "Acme" },
  });
});

describe("createPartnerInvite", () => {
  const params = {
    partnerOrgId: "org1",
    email: "New@Example.com",
    invitedByUserId: "inviter",
  };

  it("rejects member emails loudly", async () => {
    const result = await createPartnerInvite({
      ...params,
      email: "x@dali.dartmouth.edu",
    });
    expect(result).toHaveProperty("error");
    expect(mockPrisma.partnerInvite.create).not.toHaveBeenCalled();
  });

  it("rejects invitees already in this org and in other orgs distinctly", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u1",
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
    });
    mockPrisma.partnerUser.findUnique.mockResolvedValue({ partnerOrgId: "org1" });
    let result = await createPartnerInvite(params);
    expect(result).toEqual({
      error: "That person is already a member of this organization",
    });

    mockPrisma.partnerUser.findUnique.mockResolvedValue({ partnerOrgId: "org2" });
    result = await createPartnerInvite(params);
    expect(result).toEqual({
      error: "That person already belongs to another partner organization",
    });
  });

  it("supersedes pending invites and emails a link with the raw token", async () => {
    const result = await createPartnerInvite(params);
    expect(result).toEqual({ ok: true, emailSent: true });
    expect(mockPrisma.partnerInvite.updateMany).toHaveBeenCalledWith({
      where: {
        partnerOrgId: "org1",
        email: "new@example.com",
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    const createArg = mockPrisma.partnerInvite.create.mock.calls[0][0];
    expect(createArg.data.email).toBe("new@example.com");
    const url: string = (sendPartnerInviteEmail as any).mock.calls[0][3];
    expect(url).toContain("/partner/invite/");
    expect(url).not.toContain(createArg.data.tokenHash);
  });

  it("still creates the invite but reports emailSent:false on delivery failure", async () => {
    (sendPartnerInviteEmail as any).mockResolvedValue({ ok: false, error: "x" });
    const result = await createPartnerInvite(params);
    expect(result).toEqual({ ok: true, emailSent: false });
    expect(mockPrisma.partnerInvite.create).toHaveBeenCalled();
  });
});

describe("acceptPartnerInvite", () => {
  const invite = {
    id: "inv1",
    email: "new@example.com",
    displayRole: "CTO",
    partnerOrgId: "org1",
  };

  it("errors when the invite is expired, used, or revoked", async () => {
    mockPrisma.partnerInvite.updateMany.mockResolvedValue({ count: 0 });
    const result = await acceptPartnerInvite("raw");
    expect(result).toHaveProperty("error");
    expect(mockPrisma.partnerUser.create).not.toHaveBeenCalled();
  });

  it("creates the user and PartnerUser on success", async () => {
    mockPrisma.partnerInvite.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.partnerInvite.findUnique.mockResolvedValue(invite);
    const result = await acceptPartnerInvite("raw");
    expect(result).toEqual({ userId: "new-user", partnerOrgId: "org1" });
    expect(mockPrisma.partnerUser.create).toHaveBeenCalledWith({
      data: {
        userId: "new-user",
        partnerOrgId: "org1",
        displayRole: "CTO",
        authProvider: "MagicLink",
      },
    });
  });

  it("re-checks identity at accept time (invitee became a member)", async () => {
    mockPrisma.partnerInvite.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.partnerInvite.findUnique.mockResolvedValue(invite);
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u1",
      daliEmail: "new@dali.dartmouth.edu",
      dartmouthEmail: null,
      netId: null,
    });
    const result = await acceptPartnerInvite("raw");
    expect(result).toHaveProperty("error");
    expect(mockPrisma.partnerUser.create).not.toHaveBeenCalled();
  });

  it("maps the one-org-per-user unique violation to a friendly error", async () => {
    mockPrisma.partnerInvite.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.partnerInvite.findUnique.mockResolvedValue(invite);
    mockPrisma.partnerUser.create.mockRejectedValue({ code: "P2002" });
    const result = await acceptPartnerInvite("raw");
    expect(result).toEqual({
      error: "This account already belongs to a partner organization",
    });
  });
});

describe("revokePartnerInvite", () => {
  it("scopes the revoke to the caller's org", async () => {
    mockPrisma.partnerInvite.updateMany.mockResolvedValue({ count: 1 });
    const result = await revokePartnerInvite({
      inviteId: "inv1",
      partnerOrgId: "org1",
      actorUserId: "actor",
    });
    expect(result).toEqual({ ok: true });
    expect(
      mockPrisma.partnerInvite.updateMany.mock.calls[0][0].where.partnerOrgId,
    ).toBe("org1");
  });

  it("errors when nothing matches", async () => {
    mockPrisma.partnerInvite.updateMany.mockResolvedValue({ count: 0 });
    const result = await revokePartnerInvite({
      inviteId: "inv1",
      partnerOrgId: "org1",
      actorUserId: "actor",
    });
    expect(result).toEqual({ error: "Invite not found" });
  });
});
