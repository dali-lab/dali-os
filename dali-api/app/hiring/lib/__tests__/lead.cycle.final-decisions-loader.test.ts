import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");
// Phase progress and the term picker have their own tests; stub them here.
vi.mock("~/hiring/lib/hiring-emails.server", () => ({
  listHiringEmails: vi.fn().mockResolvedValue([]),
  getHiringEmail: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/hiring/lib/cycle-phases.server", () => ({
  getCycleProgress: vi.fn().mockResolvedValue({ term: null, done: {} }),
}));
vi.mock("~/hiring/lib/cycle-setup.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/hiring/lib/cycle-setup.server")>()),
  loadTermOptions: vi.fn().mockResolvedValue([]),
  loadPhaseStatusByDomain: vi.fn().mockResolvedValue({}),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCycleAdmin } from "~/lib/roles";
import { loader } from "~/hiring/routes/lead.cycle.$id";

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
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER_ID } } as any);
  vi.mocked(isCycleAdmin).mockResolvedValue(true);

  (mockPrisma as any).applicationCycle = {
    findUniqueOrThrow: vi.fn(),
  };
  (mockPrisma as any).application = { findMany: vi.fn().mockResolvedValue([]) };
  (mockPrisma as any).domain = { findMany: vi.fn() };
  (mockPrisma as any).challengeVersion = { findMany: vi.fn() };
  (mockPrisma as any).rubricVersion = { findMany: vi.fn() };
  (mockPrisma as any).applicationReview = { count: vi.fn(), findMany: vi.fn() };
  (mockPrisma as any).decision = { findMany: vi.fn() };
  // Default the gate to "signed" so the loader keeps calling decision.findMany
  // for pendingDecisions — the assertions below depend on that query firing. The
  // confidentiality gating itself is exercised in dedicated tests.
  // Confidentiality now reads the generalized signing tables (SigningBinding +
  // SigningSignature); findFirst returning a matching version = "signed".
  (mockPrisma as any).signingDocument = { findMany: vi.fn().mockResolvedValue([]) };
  (mockPrisma as any).signingBinding = {
    findFirst: vi.fn().mockResolvedValue({
      id: "test-binding",
      versionId: "test-cav",
      version: { id: "test-cav", versionNumber: 1, document: { name: "Test" } },
    }),
  };
  (mockPrisma as any).signingSignature = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue({ versionId: "test-cav" }),
  };

  mockPrisma.applicationCycle.findUniqueOrThrow.mockResolvedValue({
    id: CYCLE_ID,
    name: "Test Cycle",
    applicants: "Students",
    hasChallenges: true,
    hasInitialDelibs: true,
    hasInterviews: true,
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
});

const dec = (
  id: string,
  domainApplicationId: string,
  type: string,
  stage: string,
  createdAt: string,
) => ({ id, domainApplicationId, type, stage, createdAt: new Date(createdAt) });

describe("lead.cycle.$id loader — pending decisions", () => {
  // Drafts belong here on every kind of cycle, not just member ones: a Draft
  // made outside the delibs flow (moved by hand, or left behind when the cycle
  // closed) is otherwise invisible on the one page a lead looks at.
  it("loads every decision on the cycle and keeps only the rows awaiting the lead", async () => {
    mockPrisma.decision.findMany.mockResolvedValue([
      dec("rej-d", "da3", "Rejected", "Draft", "2026-10-04"),
      dec("acc-r", "da2", "Accepted", "Released", "2026-10-03"),
      dec("acc-f", "da2", "Accepted", "Final", "2026-10-02"),
      dec("inv-f", "da1", "InvitedToInterview", "Final", "2026-10-02"),
      dec("inv-d", "da1", "InvitedToInterview", "Draft", "2026-10-01"),
    ]);
    const req = new Request(`http://localhost/hiring-lead-admin/cycle/${CYCLE_ID}`);
    const data: any = await loader({ request: req, params: { id: CYCLE_ID }, context: {} } as any);

    expect(mockPrisma.decision.findMany).toHaveBeenCalledTimes(1);
    const where = mockPrisma.decision.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ domainApplication: { application: { applicationCycleId: CYCLE_ID } } });
    expect(data.pendingDecisions.map((d: any) => d.id)).toEqual(["rej-d", "inv-f"]);
  });

  it("retires a finalized Draft even when delibs re-created it after the Final", async () => {
    mockPrisma.decision.findMany.mockResolvedValue([
      dec("inv-d2", "da1", "InvitedToInterview", "Draft", "2026-10-03"),
      dec("inv-f", "da1", "InvitedToInterview", "Final", "2026-10-02"),
      dec("inv-d1", "da1", "InvitedToInterview", "Draft", "2026-10-01"),
    ]);
    const req = new Request(`http://localhost/hiring-lead-admin/cycle/${CYCLE_ID}`);
    const data: any = await loader({ request: req, params: { id: CYCLE_ID }, context: {} } as any);
    expect(data.pendingDecisions.map((d: any) => d.id)).toEqual(["inv-f"]);
  });
});

describe("lead.cycle.$id loader — member cycles", () => {
  it("loads pending decisions and the reviewer pool", async () => {
    mockPrisma.applicationCycle.findUniqueOrThrow.mockResolvedValue({
      id: CYCLE_ID,
      name: "Fellowship",
      applicants: "Interns",
      hasChallenges: false,
      hasInitialDelibs: false,
      hasInterviews: false,
      domains: [],
      statusUpdates: [],
      applications: [],
    });
    (mockPrisma as any).cycleReviewer = {
      findMany: vi.fn().mockResolvedValue([
        { userId: "u1", user: { firstName: "Ada", lastName: "L", daliEmail: null } },
        { userId: "u1", user: { firstName: "Ada", lastName: "L", daliEmail: null } },
      ]),
    };
    (mockPrisma as any).dALIMember = { findMany: vi.fn().mockResolvedValue([]) };

    const req = new Request(`http://localhost/hiring/lead/cycle/${CYCLE_ID}`);
    const data: any = await loader({ request: req, params: { id: CYCLE_ID }, context: {} } as any);

    expect(mockPrisma.decision.findMany).toHaveBeenCalledTimes(1);
    // One CycleReviewer row per domain collapses to one pool member.
    expect(data.memberSetup.reviewerPool).toEqual([{ userId: "u1", displayName: "Ada L" }]);
  });

  it("redirects non-admins away (Lab members cycles are Admin-only)", async () => {
    vi.mocked(isCycleAdmin).mockResolvedValueOnce(false);
    const req = new Request(`http://localhost/hiring/lead/cycle/${CYCLE_ID}`);
    const res = await loader({ request: req, params: { id: CYCLE_ID }, context: {} } as any);
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get("Location")).toBe("/");
  });
});
