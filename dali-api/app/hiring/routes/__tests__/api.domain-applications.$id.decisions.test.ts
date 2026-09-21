// Moving an applicant to a stage without a delib goes through this endpoint:
// it writes the same Draft decision a closed board would, and only the cycle's
// hiring lead or the application's own domain lead may write it.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/roles");
vi.mock("~/hiring/lib/confidentiality", () => ({
  requireApiSignedOrForbidden: vi.fn().mockResolvedValue(null),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCycleAdmin, isDomainLeadForCycle } from "~/lib/roles";
import { action } from "~/hiring/routes/api.domain-applications.$id.decisions";

const mockPrisma = prisma as unknown as Record<string, any>;

const USER_ID = "user-1";
const DA_ID = "da-1";
const DOMAIN_ID = "domain-1";

function post(body: unknown) {
  return action({
    request: new Request(`http://localhost/api/hiring/domain-applications/${DA_ID}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: DA_ID },
    context: {},
  } as any) as Promise<Response>;
}

const draftMove = { type: "InvitedToInterview", stage: "Draft", notes: "Moved without delibs." };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "lead@x.com", type: "user" },
  } as any);
  vi.mocked(isCycleAdmin).mockResolvedValue(false);
  vi.mocked(isDomainLeadForCycle).mockResolvedValue(false);
  mockPrisma.domainApplication = {
    findUnique: vi.fn().mockResolvedValue({
      domainId: DOMAIN_ID,
      application: { applicationCycleId: "c1" },
    }),
  };
  mockPrisma.dALIMember = { findUnique: vi.fn().mockResolvedValue({ id: "m1", userId: USER_ID }) };
  mockPrisma.domainLeadAssignment = { findFirst: vi.fn().mockResolvedValue(null) };
  mockPrisma.decision = {
    create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "dec-1", ...data })),
  };
});

describe("POST /api/hiring/domain-applications/:id/decisions", () => {
  it("lets the application's own domain lead record a draft decision", async () => {
    vi.mocked(isDomainLeadForCycle).mockResolvedValue(true);
    mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue({ id: "a1" });

    const res = await post(draftMove);

    expect(res.status).toBe(201);
    expect(mockPrisma.decision.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.decision.create.mock.calls[0][0].data).toMatchObject({
      domainApplicationId: DA_ID,
      type: "InvitedToInterview",
      stage: "Draft",
      madeById: USER_ID,
      notes: "Moved without delibs.",
    });
    // A move is a draft: nothing is finalized or released here.
    expect(mockPrisma.domainLeadAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, domainId: DOMAIN_ID } }),
    );
  });

  it("lets the hiring lead record one without a domain assignment", async () => {
    vi.mocked(isCycleAdmin).mockResolvedValue(true);
    const res = await post(draftMove);
    expect(res.status).toBe(201);
  });

  it("refuses a domain lead of some other domain", async () => {
    vi.mocked(isDomainLeadForCycle).mockResolvedValue(true);
    mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue(null);

    const res = await post(draftMove);

    expect(res.status).toBe(403);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
  });

  it("refuses someone who leads nothing", async () => {
    const res = await post(draftMove);
    expect(res.status).toBe(403);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
  });

  it("still keeps releasing to the hiring lead", async () => {
    vi.mocked(isDomainLeadForCycle).mockResolvedValue(true);
    mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue({ id: "a1" });

    const res = await post({ type: "Accepted", stage: "Released" });

    expect(res.status).toBe(403);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
  });
});
