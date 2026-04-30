import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  withAuth: <T,>(_auth: unknown, value: T) => value,
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { loader } from "~/routes/admin.cycle.$id";

const USER_ID = "user-hl";
const CYCLE_ID = "cycle-1";

const mockPrisma = prisma as unknown as {
  applicationCycle: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  domain: { findMany: ReturnType<typeof vi.fn> };
  challengeVersion: { findMany: ReturnType<typeof vi.fn> };
  rubricVersion: { findMany: ReturnType<typeof vi.fn> };
  applicationReview: {
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  decision: { findMany: ReturnType<typeof vi.fn> };
  emailTemplate: { findMany: ReturnType<typeof vi.fn> };
  cycleDecisionEmail: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER_ID } } as any);
  vi.mocked(isHiringLead).mockResolvedValue(true);

  (mockPrisma as any).applicationCycle = { findUniqueOrThrow: vi.fn() };
  (mockPrisma as any).domain = { findMany: vi.fn() };
  (mockPrisma as any).challengeVersion = { findMany: vi.fn() };
  (mockPrisma as any).rubricVersion = { findMany: vi.fn() };
  (mockPrisma as any).applicationReview = { count: vi.fn(), findMany: vi.fn() };
  (mockPrisma as any).decision = { findMany: vi.fn() };
  (mockPrisma as any).emailTemplate = { findMany: vi.fn() };
  (mockPrisma as any).cycleDecisionEmail = { findMany: vi.fn() };

  mockPrisma.applicationCycle.findUniqueOrThrow.mockResolvedValue({
    id: CYCLE_ID,
    name: "Test Cycle",
    domains: [],
    statusUpdates: [],
    challengeVersions: [],
    applications: [],
  });
  mockPrisma.domain.findMany.mockResolvedValue([]);
  mockPrisma.challengeVersion.findMany.mockResolvedValue([]);
  mockPrisma.rubricVersion.findMany.mockResolvedValue([]);
  mockPrisma.applicationReview.count.mockResolvedValue(0);
  mockPrisma.applicationReview.findMany.mockResolvedValue([]);
  mockPrisma.decision.findMany.mockResolvedValue([]);
  mockPrisma.emailTemplate.findMany.mockResolvedValue([]);
  mockPrisma.cycleDecisionEmail.findMany.mockResolvedValue([]);
});

describe("admin.cycle.$id loader — finalDecisions filter", () => {
  it("excludes Final decisions that already have a Released child", async () => {
    const req = new Request(`http://localhost/hiring-lead-admin/cycle/${CYCLE_ID}`);
    await loader({ request: req, params: { id: CYCLE_ID }, context: {} } as any);

    const finalCall = mockPrisma.decision.findMany.mock.calls.find(
      (c: any[]) => c[0]?.where?.stage === "Final",
    );
    expect(finalCall).toBeDefined();
    expect(finalCall![0].where).toMatchObject({
      stage: "Final",
      children: { none: { stage: "Released" } },
      domainApplication: { application: { applicationCycleId: CYCLE_ID } },
    });
  });
});
