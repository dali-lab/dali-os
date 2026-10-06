import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { loader } from "~/hiring/routes/applications";

const mockPrisma = prisma as unknown as Record<string, any>;

const CYCLE_ID = "cycle-1";
const APPLICATION_ID = "app-1";
const DOMAIN_ID = "domain-design";
const DA_ID = "da-1";

function makeRequest(query = "") {
  return new Request(`http://localhost/hiring/applications${query}`);
}

function callLoader(query = "") {
  return loader({ request: makeRequest(query), params: {}, context: {} } as any);
}

function baseDomainApp(overrides: Partial<{ user: any }> = {}) {
  return {
    id: DA_ID,
    domainId: DOMAIN_ID,
    domain: { displayName: "Design" },
    application: {
      id: APPLICATION_ID,
      user: overrides.user ?? {
        firstName: "Ada",
        lastName: "Lovelace",
        daliEmail: "ada@dali.dartmouth.edu",
        dartmouthEmail: "ada@dartmouth.edu",
      },
      statusUpdates: [{ newStatus: "Submitted", createdAt: new Date("2026-01-01") }],
    },
    _count: { reviews: 0 },
    closureReason: null,
    decisions: [],
    interviews: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "viewer-1", type: "user" } } as any);
  vi.mocked(getUserRoles).mockResolvedValue({
    isCore: true,
    isAdmin: false,
    isDomainLead: false,
    isInterviewer: false,
  } as any);

  mockPrisma.cycleReviewer = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.cycleInterviewer = { findFirst: vi.fn().mockResolvedValue(null) };
  mockPrisma.applicationCycle = {
    findMany: vi.fn().mockResolvedValue([
      {
        id: CYCLE_ID,
        name: "Fall Cycle",
        createdAt: new Date("2026-01-01"),
        applicants: "Students",
        anonymizeReview: true,
        statusUpdates: [{ newStatus: "Reviewing" }],
      },
    ]),
  };
  mockPrisma.domainApplicationCycle = { findMany: vi.fn().mockResolvedValue([{ domainId: DOMAIN_ID }]) };
  mockPrisma.domain = { findMany: vi.fn().mockResolvedValue([{ id: DOMAIN_ID, displayName: "Design" }]) };
  mockPrisma.decision = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.application = { findMany: vi.fn().mockResolvedValue([{ id: APPLICATION_ID }]) };

  // domainApplication.findMany is called twice with different `where` shapes:
  // once scoped to visible domains (builds the rows), once unscoped per
  // applicationId (the full-application blind check).
  mockPrisma.domainApplication = {
    findMany: vi.fn().mockImplementation(({ where }: any) => {
      if (where.domainId) return Promise.resolve([baseDomainApp()]);
      return Promise.resolve([{ id: DA_ID, applicationId: APPLICATION_ID }]);
    }),
  };
});

describe("applications.tsx loader — blind review", () => {
  it("blinds the row's name and email when the cycle anonymizes review and nothing is released", async () => {
    const result: any = await callLoader();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe("Applicant 1");
    expect(result.rows[0].email).toBeNull();
  });

  it("shows the real name and email once the domain's decision is released", async () => {
    mockPrisma.decision.findMany.mockResolvedValue([{ domainApplicationId: DA_ID }]);
    const result: any = await callLoader();
    expect(result.rows[0].name).toBe("Ada Lovelace");
    expect(result.rows[0].email).toBe("ada@dali.dartmouth.edu");
  });

  it("does not blind when the cycle has anonymizeReview off", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      {
        id: CYCLE_ID,
        name: "Fall Cycle",
        createdAt: new Date("2026-01-01"),
        applicants: "Students",
        anonymizeReview: false,
        statusUpdates: [{ newStatus: "Reviewing" }],
      },
    ]);
    const result: any = await callLoader();
    expect(result.rows[0].name).toBe("Ada Lovelace");
  });
});
