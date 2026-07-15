import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db", () => ({
  prisma: {
    partnerUser: { findUnique: vi.fn() },
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
    user: { sub: "u1", type, email: "", firstName: "", lastName: "" },
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
  mockPrisma.partnerUser.findUnique.mockResolvedValue(null);
  mockPrisma.dALIMember.findUnique.mockResolvedValue(null);
});

describe("requirePartner redirect matrix", () => {
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

  it("partner-type without PartnerUser row → /partner/onboarding", async () => {
    authedAs("partner");
    expect(await redirectTarget(requirePartner(req()))).toBe("/partner/onboarding");
  });

  it("member in the provisioning window (DALIMember, no daliEmail) → /", async () => {
    authedAs("partner");
    mockPrisma.dALIMember.findUnique.mockResolvedValue({ id: "m1" });
    expect(await redirectTarget(requirePartner(req()))).toBe("/");
  });

  it("returns the partner context on the happy path", async () => {
    authedAs("partner");
    mockPrisma.partnerUser.findUnique.mockResolvedValue({
      id: "pu1",
      displayRole: "CTO",
      partnerOrgId: "org1",
      partnerOrg: {
        id: "org1",
        name: "Acme",
        logoUrl: null,
        website: null,
        isIndividual: false,
        primaryContactId: "pu1",
      },
    });
    const ctx = await requirePartner(req());
    expect(ctx.partnerUser).toEqual({
      id: "pu1",
      displayRole: "CTO",
      partnerOrgId: "org1",
    });
    expect(ctx.org.name).toBe("Acme");
  });
});

describe("requirePartnerCandidate", () => {
  it("allows partner-type users with no PartnerUser row", async () => {
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
