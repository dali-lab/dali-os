import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  requireCore: vi.fn(),
  requireCoreOrDomainLead: vi.fn(),
  requireMemberSession: vi.fn(),
  forbidden: vi.fn((_req: Request) =>
    Response.json({ error: "Forbidden" }, { status: 403 }),
  ),
  unauthorized: vi.fn((_req: Request) =>
    Response.json({ error: "Unauthorized" }, { status: 401 }),
  ),
  redirectApplicantToPortal: vi.fn(() => null),
}));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db";
import { requireAuth, requireCoreOrDomainLead } from "~/lib/auth";
import { isCore, isDomainLead } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/hiring/routes/api.cycles.$cycleId.reviewers.$reviewerId";

const mockPrisma = prisma as unknown as {
  $transaction: ReturnType<typeof vi.fn>;
  applicationReview: { deleteMany: ReturnType<typeof vi.fn> };
  cycleReviewer: { delete: ReturnType<typeof vi.fn> };
};

const USER_ID = "user-1";
const CYCLE_ID = "cycle-1";
const REVIEWER_ID = "reviewer-1";

function makeRequest() {
  return new Request(`http://localhost/api/cycles/${CYCLE_ID}/reviewers/${REVIEWER_ID}`, {
    method: "DELETE",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).applicationReview = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  (mockPrisma as any).cycleReviewer = {
    delete: vi.fn().mockResolvedValue({ userId: "reviewer-user", domainId: "domain-1" }),
  };
  (mockPrisma as any).$transaction = vi.fn(async (cb: any) => cb(mockPrisma));
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as any);
  vi.mocked(requireCoreOrDomainLead).mockResolvedValue({
    ok: true,
    auth: {
      ok: true,
      user: { sub: USER_ID, email: "u@x.com", type: "user" },
      sessionId: "sid",
    },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isDomainLead).mockResolvedValue(false);
});

describe("DELETE /api/hiring/cycles/:cycleId/reviewers/:reviewerId", () => {
  it("returns 403 when caller is not a hiring or domain lead", async () => {
    vi.mocked(isCore).mockResolvedValueOnce(false);
    vi.mocked(isDomainLead).mockResolvedValueOnce(false);
    vi.mocked(requireCoreOrDomainLead).mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await action({
      request: makeRequest(),
      params: { cycleId: CYCLE_ID, reviewerId: REVIEWER_ID },
      context: {},
    } as any);
    expect(res.status).toBe(403);
    expect(mockPrisma.cycleReviewer.delete).not.toHaveBeenCalled();
  });

  it("removes a reviewer with no reviews", async () => {
    const res = await action({
      request: makeRequest(),
      params: { cycleId: CYCLE_ID, reviewerId: REVIEWER_ID },
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(mockPrisma.applicationReview.deleteMany).toHaveBeenCalledWith({
      where: { cycleReviewerId: REVIEWER_ID },
    });
    expect(mockPrisma.cycleReviewer.delete).toHaveBeenCalledWith({
      where: { id: REVIEWER_ID },
      select: { userId: true, domainId: true },
    });
  });

  it("cascades existing reviews and removes the reviewer", async () => {
    mockPrisma.applicationReview.deleteMany.mockResolvedValueOnce({ count: 4 });
    const res = await action({
      request: makeRequest(),
      params: { cycleId: CYCLE_ID, reviewerId: REVIEWER_ID },
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.applicationReview.deleteMany).toHaveBeenCalledWith({
      where: { cycleReviewerId: REVIEWER_ID },
    });
    expect(mockPrisma.cycleReviewer.delete).toHaveBeenCalledWith({
      where: { id: REVIEWER_ID },
      select: { userId: true, domainId: true },
    });
    const appReviewOrder = mockPrisma.applicationReview.deleteMany.mock.invocationCallOrder[0];
    const cycleReviewerOrder = mockPrisma.cycleReviewer.delete.mock.invocationCallOrder[0];
    expect(appReviewOrder).toBeLessThan(cycleReviewerOrder);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "reviewer.remove",
        userId: USER_ID,
        targetId: REVIEWER_ID,
        metadata: {
          cycleId: CYCLE_ID,
          reviewerUserId: "reviewer-user",
          domainId: "domain-1",
          deletedReviews: 4,
        },
      }),
    );
  });

  it("returns 404 when the reviewer row is missing (P2025)", async () => {
    mockPrisma.cycleReviewer.delete.mockRejectedValueOnce({ code: "P2025" });
    const res = await action({
      request: makeRequest(),
      params: { cycleId: CYCLE_ID, reviewerId: REVIEWER_ID },
      context: {},
    } as any);
    expect(res.status).toBe(404);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
