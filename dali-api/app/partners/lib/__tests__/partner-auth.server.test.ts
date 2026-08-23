import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db", () => ({
  prisma: {
    partnerContact: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    partnerMembership: { findMany: vi.fn() },
    dALIMember: { findUnique: vi.fn() },
  },
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { requirePartner, requirePartnerCandidate } from "../partner-auth.server";

const mockPrisma = prisma as any;
const req = () => new Request("http://localhost/partner");

const authedAs = (type: string) =>
  (requireAuth as any).mockResolvedValue({
    ok: true,
    user: { sub: "u1", type, email: "ada@acme.com", firstName: "", lastName: "" },
    sessionId: "s1",
  });

async function redirectTarget(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (e) {
    if (e instanceof Response) return e.headers.get("Location");
    throw e;
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.partnerContact.findUnique.mockResolvedValue(null);
  mockPrisma.partnerContact.create.mockResolvedValue({
    id: "c1",
    name: "Ada",
    email: "ada@acme.com",
    userId: "u1",
  });
  mockPrisma.partnerContact.update.mockResolvedValue({
    id: "c1",
    name: "Ada",
    email: "ada@acme.com",
    userId: "u1",
  });
  mockPrisma.partnerMembership.findMany.mockResolvedValue([]);
  mockPrisma.dALIMember.findUnique.mockResolvedValue(null);
});

describe("requirePartnerAccount redirect matrix", () => {
  it("unauthenticated → /partner/login", async () => {
    (requireAuth as any).mockResolvedValue({ ok: false });
    expect(await redirectTarget(requirePartner(req()))).toBe("/partner/login");
  });

  it("member → /", async () => {
    authedAs("member");
    expect(await redirectTarget(requirePartner(req()))).toBe("/");
  });

  it("dartmouth student → /portal", async () => {
    authedAs("dartmouth");
    expect(await redirectTarget(requirePartner(req()))).toBe("/portal");
  });

  it("partner-type without a contact is provisioned one (no redirect)", async () => {
    authedAs("partner");
    const ctx = await requirePartner(req());
    expect(ctx.contact.id).toBe("c1");
    expect(ctx.memberships).toEqual([]);
    expect(mockPrisma.partnerContact.create).toHaveBeenCalled();
  });

  it("member in the provisioning window (DALIMember, no daliEmail) → /", async () => {
    authedAs("partner");
    mockPrisma.dALIMember.findUnique.mockResolvedValue({ id: "m1" });
    expect(await redirectTarget(requirePartner(req()))).toBe("/");
  });

  it("returns the account context with memberships on the happy path", async () => {
    authedAs("partner");
    mockPrisma.partnerContact.findUnique.mockResolvedValue({
      id: "c1",
      name: "Ada",
      email: "ada@acme.com",
      userId: "u1",
    });
    mockPrisma.partnerMembership.findMany.mockResolvedValue([
      {
        id: "m1",
        orgId: "org1",
        role: "CTO",
        org: {
          id: "org1",
          name: "Acme",
          logoUrl: null,
          website: null,
          isIndividual: false,
          primaryContactId: "m1",
        },
      },
    ]);
    const ctx = await requirePartner(req());
    expect(ctx.contact).toEqual({
      id: "c1",
      name: "Ada",
      email: "ada@acme.com",
      userId: "u1",
    });
    expect(ctx.memberships[0].org.name).toBe("Acme");
  });
});

describe("requirePartnerCandidate", () => {
  it("allows partner-type users with no contact row", async () => {
    authedAs("partner");
    const auth = await requirePartnerCandidate(req());
    expect(auth.user.sub).toBe("u1");
  });

  it("bounces members and provisioning-window members", async () => {
    authedAs("member");
    expect(await redirectTarget(requirePartnerCandidate(req()))).toBe("/");

    authedAs("partner");
    mockPrisma.dALIMember.findUnique.mockResolvedValue({ id: "m1" });
    expect(await redirectTarget(requirePartnerCandidate(req()))).toBe("/");
  });
});
