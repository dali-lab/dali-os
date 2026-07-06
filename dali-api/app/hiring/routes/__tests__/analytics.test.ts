import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { loader } from "~/hiring/routes/analytics";

const HIRING_LEAD_ID = "hiring-lead-1";
const CYCLE_ID = "cycle-1";
const DOMAIN_ID = "domain-1";
const CAV_ID = "cav-1";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: HIRING_LEAD_ID, email: "lead@x.com", type: "user" },
  } as any);
  vi.mocked(getUserRoles).mockResolvedValue({
    isLabMember: false,
    isCore: true,
    isAdmin: false,
    isDomainLead: false,
    isInstructor: false,
    isAlumni: false,
    canViewForms: true,
    canViewStaffing: true,
  });

  mockPrisma.applicationCycle = {
    findMany: vi.fn().mockResolvedValue([
      {
        id: CYCLE_ID,
        name: "Cycle 1",
        statusUpdates: [{ newStatus: "Open" }],
      },
    ]),
  };
  mockPrisma.domainApplicationCycle = {
    findMany: vi.fn().mockResolvedValue([
      { domain: { id: DOMAIN_ID, name: "Web" } },
    ]),
  };
  mockPrisma.domainApplication = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.cycleConfidentialityAgreement = { findUnique: vi.fn() };
  mockPrisma.confidentialityAgreementSignature = { findUnique: vi.fn() };
});

function callLoader(search = "") {
  const url = `http://localhost/hiring/analytics${search}`;
  return loader({
    request: new Request(url),
    params: {},
    context: {},
  } as any);
}

describe("hiring/analytics loader — confidentiality gating", () => {
  it("returns 'unsigned' and empty rows/slices when the user has not signed the bound agreement", async () => {
    mockPrisma.cycleConfidentialityAgreement.findUnique.mockResolvedValue({
      confidentialityAgreementVersionId: CAV_ID,
    });
    mockPrisma.confidentialityAgreementSignature.findUnique.mockResolvedValue(null);

    const data = (await callLoader()) as any;

    expect(data.confidentialityRequired).toBe("unsigned");
    expect(data.rows).toEqual([]);
    expect(data.slices).toEqual([]);
    expect(data.selectedStatus).toBeNull();
    // Selectors still render — the cycle/domain lists are non-sensitive.
    expect(data.selectedCycleId).toBe(CYCLE_ID);
    expect(data.accessibleDomains).toEqual([{ id: DOMAIN_ID, name: "Web" }]);
    // The expensive sensitive query must be skipped.
    expect(mockPrisma.domainApplication.findMany).not.toHaveBeenCalled();
  });

  it("returns 'no_agreement' and empty rows/slices when the cycle has no bound agreement", async () => {
    mockPrisma.cycleConfidentialityAgreement.findUnique.mockResolvedValue(null);
    mockPrisma.confidentialityAgreementSignature.findUnique.mockResolvedValue(null);

    const data = (await callLoader()) as any;

    expect(data.confidentialityRequired).toBe("no_agreement");
    expect(data.rows).toEqual([]);
    expect(data.slices).toEqual([]);
    expect(mockPrisma.domainApplication.findMany).not.toHaveBeenCalled();
  });

  it("returns the populated payload when the user has signed the bound agreement", async () => {
    mockPrisma.cycleConfidentialityAgreement.findUnique.mockResolvedValue({
      confidentialityAgreementVersionId: CAV_ID,
    });
    mockPrisma.confidentialityAgreementSignature.findUnique.mockResolvedValue({
      confidentialityAgreementVersionId: CAV_ID,
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      {
        id: "da-1",
        application: {
          statusUpdates: [{ newStatus: "Submitted" }],
          user: { firstName: "Ada", lastName: "Lovelace" },
        },
        challengeVersion: { domain: { id: DOMAIN_ID, name: "Web" } },
        reviews: [],
        interviews: [],
        decisions: [],
      },
    ]);

    const data = (await callLoader()) as any;

    expect(data.confidentialityRequired).toBeNull();
    expect(mockPrisma.domainApplication.findMany).toHaveBeenCalledTimes(1);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].applicantName).toBe("Ada Lovelace");
  });
});
