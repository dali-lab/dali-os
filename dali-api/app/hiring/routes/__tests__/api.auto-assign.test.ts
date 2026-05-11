import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  withAuth: <T,>(_auth: unknown, value: T) => value,
}));
vi.mock("~/lib/roles");
vi.mock("~/hiring/lib/confidentiality", () => ({
  requireApiSignedOrForbidden: vi.fn().mockResolvedValue(null),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead } from "~/lib/roles";
import { action } from "~/hiring/routes/api.cycles.$cycleId.domains.$domainId.auto-assign";

const USER_ID = "user-hl";
const CYCLE_ID = "cycle-1";
const DOMAIN_ID = "domain-1";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "lead@x.com", type: "user" },
  } as any);
  vi.mocked(isHiringLead).mockResolvedValue(true);
  vi.mocked(isDomainLead).mockResolvedValue(false);

  mockPrisma.applicationCycle = {
    findUniqueOrThrow: vi.fn().mockResolvedValue({
      id: CYCLE_ID,
      generalRubricVersionId: "rubric-general",
    }),
  };
  mockPrisma.domainApplicationCycle = {
    findUnique: vi.fn().mockResolvedValue({
      reviewersPerApplication: 2,
      rubricVersionId: "rubric-domain",
    }),
  };
  mockPrisma.cycleReviewer = {
    findMany: vi.fn().mockResolvedValue([
      { id: "rev-1", reviews: [] },
      { id: "rev-2", reviews: [] },
    ]),
  };
  mockPrisma.domainApplication = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.applicationReview = { create: vi.fn().mockResolvedValue({}) };
});

function callAction() {
  return action({
    request: new Request(
      `http://localhost/api/cycles/${CYCLE_ID}/domains/${DOMAIN_ID}/auto-assign`,
      { method: "POST" },
    ),
    params: { cycleId: CYCLE_ID, domainId: DOMAIN_ID },
    context: {},
  } as any);
}

describe("auto-assign action — withdrawn applications are skipped", () => {
  it("queries DomainApplication with a NOT { Withdrawn } filter on the parent application", async () => {
    await callAction();

    expect(mockPrisma.domainApplication.findMany).toHaveBeenCalledTimes(1);
    const where = mockPrisma.domainApplication.findMany.mock.calls[0][0].where;

    // Submitted requirement is still there...
    expect(where.application.statusUpdates).toEqual({
      some: { newStatus: "Submitted" },
    });
    // ...and the new "not Withdrawn" guard is too.
    expect(where.application.NOT).toEqual({
      statusUpdates: { some: { newStatus: "Withdrawn" } },
    });
  });

  it("does not create reviews when there are no qualifying applications", async () => {
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);

    const res = await callAction();

    expect(mockPrisma.applicationReview.create).not.toHaveBeenCalled();
    const body = await (res as Response).json();
    expect(body).toEqual({ assigned: 0 });
  });
});
