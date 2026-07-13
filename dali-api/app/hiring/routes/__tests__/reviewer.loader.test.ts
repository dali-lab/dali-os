import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/hiring/lib/cycles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/hiring/lib/cycles")>();
  return {
    ...actual,
    getActiveCycle: vi.fn(),
    inferUnderReviewStage: vi.fn().mockResolvedValue("review"),
  };
});
vi.mock("~/hiring/lib/confidentiality", () => ({
  getCycleConfidentialityState: vi.fn().mockResolvedValue({ status: "signed" }),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { loader } from "~/hiring/routes/reviewer";

const USER_ID = "user-rev";
const MEMBER_ID = "member-rev";
const CYCLE_ID = "cycle-1";
const DOMAIN_ID = "domain-1";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "rev@x.com", type: "user" },
  } as any);
  vi.mocked(getActiveCycle).mockResolvedValue({
    id: CYCLE_ID,
    name: "Cycle 1",
    currentStatus: "UnderReview",
  } as any);

  mockPrisma.dALIMember = { findUnique: vi.fn().mockResolvedValue({ id: MEMBER_ID, userId: USER_ID }),
  };
  mockPrisma.cycleReviewer = {
    findMany: vi
      .fn()
      .mockResolvedValue([{ id: "cr-1", domainId: DOMAIN_ID }]),
  };
  mockPrisma.applicationReview = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  mockPrisma.cycleInterviewer = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
  };
  mockPrisma.delibsSession = {
    findMany: vi.fn().mockResolvedValue([]),
  };
});

function callLoader() {
  return loader({
    request: new Request("http://localhost/hiring/reviewer"),
    params: {},
    context: {},
  } as any);
}

describe("reviewer loader — myReviews filter", () => {
  it("queries ApplicationReview with a filter that requires Submitted and excludes Withdrawn on the parent application", async () => {
    await callLoader();

    expect(mockPrisma.applicationReview.findMany).toHaveBeenCalledTimes(1);
    const where = mockPrisma.applicationReview.findMany.mock.calls[0][0].where;

    expect(where.cycleReviewerId).toEqual({ in: ["cr-1"] });
    expect(where.domainApplication.application.statusUpdates).toEqual({
      some: { newStatus: "Submitted" },
    });
    expect(where.domainApplication.application.NOT).toEqual({
      statusUpdates: { some: { newStatus: "Withdrawn" } },
    });
  });
});
