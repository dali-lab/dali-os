import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    dALIMember: { findUnique: vi.fn() },
    partnerContact: { findUnique: vi.fn(), upsert: vi.fn() },
    partnerMembership: { create: vi.fn() },
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
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(),
  drainNow: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { enqueueOutbound } from "~/lib/outbound.server";
import {
  acceptPartnerInvite,
  createPartnerInvite,
  revokePartnerInvite,
} from "../invites.server";

const mockPrisma = prisma as any;
const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  mockEnqueue.mockResolvedValue({ id: "om-x", deduped: false });
  mockPrisma.user.findFirst.mockResolvedValue(null);
  mockPrisma.user.findUnique.mockResolvedValue({ firstName: "Ada", lastName: "L" });
  mockPrisma.user.create.mockResolvedValue({ id: "new-user" });
  mockPrisma.dALIMember.findUnique.mockResolvedValue(null);
  // Default: contact has no membership in any org (multi-org: only same-org check)
  mockPrisma.partnerContact.findUnique.mockResolvedValue({ memberships: [] });
  mockPrisma.partnerContact.upsert.mockResolvedValue({ id: "contact1" });
  mockPrisma.partnerMembership.create.mockResolvedValue({ id: "mem1" });
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

  it("rejects invitees already a member of THIS org, allows members of other orgs", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u1",
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
    });

    // Already in org1 (the same org being invited to) → reject
    mockPrisma.partnerContact.findUnique.mockResolvedValue({
      memberships: [{ id: "mem1" }],
    });
    let result = await createPartnerInvite(params);
    expect(result).toEqual({
      error: "That person is already a member of this organization",
    });

    // In a different org only → multi-org is allowed, should proceed to invite
    mockPrisma.partnerContact.findUnique.mockResolvedValue({ memberships: [] });
    result = await createPartnerInvite(params);
    expect(result).toEqual({ ok: true });
  });

  it("supersedes pending invites and emails a link with the raw token", async () => {
    const result = await createPartnerInvite(params);
    expect(result).toEqual({ ok: true });
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
    // The invite email is enqueued to the outbox; the raw-token link lives in
    // its bodyHtml, and the stored hash is never exposed.
    const emailArg = mockEnqueue.mock.calls[0][0];
    expect(emailArg.channel).toBe("email");
    expect(emailArg.bodyHtml).toContain("/partner/invite/");
    expect(emailArg.bodyHtml).not.toContain(createArg.data.tokenHash);
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
    expect(mockPrisma.partnerMembership.create).not.toHaveBeenCalled();
  });

  it("creates a PartnerContact (upsert) and PartnerMembership on success", async () => {
    mockPrisma.partnerInvite.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.partnerInvite.findUnique.mockResolvedValue(invite);
    const result = await acceptPartnerInvite("raw");
    expect(result).toEqual({ userId: "new-user", partnerOrgId: "org1" });
    // Contact is upserted by email
    expect(mockPrisma.partnerContact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: invite.email },
        create: expect.objectContaining({ email: invite.email }),
      }),
    );
    // Membership is created linking the contact to the org
    expect(mockPrisma.partnerMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactId: "contact1",
          orgId: "org1",
          role: "CTO",
        }),
      }),
    );
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
    expect(mockPrisma.partnerMembership.create).not.toHaveBeenCalled();
  });

  it("maps the already-member-of-this-org unique violation to a friendly error", async () => {
    mockPrisma.partnerInvite.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.partnerInvite.findUnique.mockResolvedValue(invite);
    mockPrisma.partnerMembership.create.mockRejectedValue({ code: "P2002" });
    const result = await acceptPartnerInvite("raw");
    expect(result).toEqual({
      error: "This account is already a member of this organization",
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
