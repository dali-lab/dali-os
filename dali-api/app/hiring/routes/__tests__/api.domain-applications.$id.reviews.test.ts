import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { action } from "~/hiring/routes/api.domain-applications.$id.reviews";

const mockPrisma = prisma as unknown as {
  domainApplication: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  applicationCycle: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  domainApplicationCycle: { findUnique: ReturnType<typeof vi.fn> };
  applicationReview: { create: ReturnType<typeof vi.fn> };
  dALIMember: { findFirst: ReturnType<typeof vi.fn> };
};

const USER_ID = "user-1";
const DA_ID = "da-1";
const CYCLE_ID = "cycle-1";
const DOMAIN_ID = "dom-1";
const OTHER_DOMAIN_ID = "dom-2";
const CYCLE_REVIEWER_ID = "cr-1";

function makeRequest(body: unknown = { cycleReviewerId: CYCLE_REVIEWER_ID }) {
  return new Request(`http://localhost/api/domain-applications/${DA_ID}/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).domainApplication = {
    findUniqueOrThrow: vi.fn().mockResolvedValue({
      id: DA_ID,
      selected: true,
      application: { applicationCycleId: CYCLE_ID },
      challengeVersion: { domainId: DOMAIN_ID },
    }),
  };
  (mockPrisma as any).applicationCycle = {
    findUniqueOrThrow: vi.fn().mockResolvedValue({
      id: CYCLE_ID,
      generalRubricVersionId: "grv-1",
    }),
  };
  (mockPrisma as any).domainApplicationCycle = {
    findUnique: vi.fn().mockResolvedValue({ rubricVersionId: "drv-1" }),
  };
  (mockPrisma as any).applicationReview = {
    create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "rev-1", ...data })),
  };
  (mockPrisma as any).dALIMember = {
    findFirst: vi.fn().mockResolvedValue(null),
  };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as any);
  vi.mocked(isHiringLead).mockResolvedValue(false);
});

describe("POST /api/hiring/domain-applications/:id/reviews", () => {
  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as any);

    const res = await action({
      request: makeRequest(),
      params: { id: DA_ID },
      context: {},
    } as any);
    expect(res.status).toBe(401);
    expect(mockPrisma.applicationReview.create).not.toHaveBeenCalled();
  });

  it("returns 405 for non-POST methods", async () => {
    const req = new Request(`http://localhost/api/domain-applications/${DA_ID}/reviews`, {
      method: "DELETE",
    });
    const res = await action({
      request: req,
      params: { id: DA_ID },
      context: {},
    } as any);
    expect(res.status).toBe(405);
  });

  it("returns 400 when cycleReviewerId is missing", async () => {
    const res = await action({
      request: makeRequest({}),
      params: { id: DA_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.applicationReview.create).not.toHaveBeenCalled();
  });

  it("allows a hiring lead to assign a reviewer (201)", async () => {
    vi.mocked(isHiringLead).mockResolvedValue(true);

    const res = await action({
      request: makeRequest(),
      params: { id: DA_ID },
      context: {},
    } as any);

    expect(res.status).toBe(201);
    expect(mockPrisma.applicationReview.create).toHaveBeenCalledWith({
      data: { domainApplicationId: DA_ID, cycleReviewerId: CYCLE_REVIEWER_ID },
    });
    expect(mockPrisma.dALIMember.findFirst).not.toHaveBeenCalled();
  });

  it("allows a domain lead for the matching domain (201)", async () => {
    mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: "member-1" });

    const res = await action({
      request: makeRequest(),
      params: { id: DA_ID },
      context: {},
    } as any);

    expect(res.status).toBe(201);
    expect(mockPrisma.dALIMember.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        domainLeadAssignments: { some: { domainId: DOMAIN_ID } },
      },
      select: { id: true },
    });
    expect(mockPrisma.applicationReview.create).toHaveBeenCalled();
  });

  it("rejects a domain lead for a different domain (403)", async () => {
    mockPrisma.domainApplication.findUniqueOrThrow.mockResolvedValueOnce({
      id: DA_ID,
      selected: true,
      application: { applicationCycleId: CYCLE_ID },
      challengeVersion: { domainId: OTHER_DOMAIN_ID },
    });
    // dALIMember.findFirst is scoped to OTHER_DOMAIN_ID — user has no assignment there.
    mockPrisma.dALIMember.findFirst.mockResolvedValue(null);

    const res = await action({
      request: makeRequest(),
      params: { id: DA_ID },
      context: {},
    } as any);

    expect(res.status).toBe(403);
    expect(mockPrisma.dALIMember.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        domainLeadAssignments: { some: { domainId: OTHER_DOMAIN_ID } },
      },
      select: { id: true },
    });
    expect(mockPrisma.applicationReview.create).not.toHaveBeenCalled();
  });

  it("rejects a non-lead, non-hiring-lead member (403)", async () => {
    mockPrisma.dALIMember.findFirst.mockResolvedValue(null);

    const res = await action({
      request: makeRequest(),
      params: { id: DA_ID },
      context: {},
    } as any);

    expect(res.status).toBe(403);
    expect(mockPrisma.applicationReview.create).not.toHaveBeenCalled();
  });

  it("returns 409 when the domain application is deselected", async () => {
    vi.mocked(isHiringLead).mockResolvedValue(true);
    mockPrisma.domainApplication.findUniqueOrThrow.mockResolvedValueOnce({
      id: DA_ID,
      selected: false,
      application: { applicationCycleId: CYCLE_ID },
      challengeVersion: { domainId: DOMAIN_ID },
    });

    const res = await action({
      request: makeRequest(),
      params: { id: DA_ID },
      context: {},
    } as any);

    expect(res.status).toBe(409);
    expect(mockPrisma.applicationReview.create).not.toHaveBeenCalled();
  });

  it("returns 400 when the cycle has no general rubric set", async () => {
    vi.mocked(isHiringLead).mockResolvedValue(true);
    mockPrisma.applicationCycle.findUniqueOrThrow.mockResolvedValueOnce({
      id: CYCLE_ID,
      generalRubricVersionId: null,
    });

    const res = await action({
      request: makeRequest(),
      params: { id: DA_ID },
      context: {},
    } as any);

    expect(res.status).toBe(400);
    expect(mockPrisma.applicationReview.create).not.toHaveBeenCalled();
  });

  it("returns 400 when the domain has no rubric set for this cycle", async () => {
    vi.mocked(isHiringLead).mockResolvedValue(true);
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValueOnce(null);

    const res = await action({
      request: makeRequest(),
      params: { id: DA_ID },
      context: {},
    } as any);

    expect(res.status).toBe(400);
    expect(mockPrisma.applicationReview.create).not.toHaveBeenCalled();
  });
});
