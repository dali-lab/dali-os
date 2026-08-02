import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { getPipelineData } from "~/hiring/lib/pipeline.server";

const HIRING_LEAD_ID = "hiring-lead-1";
const CYCLE_ID = "cycle-1";
const DOMAIN_ID = "domain-1";
const CAV_ID = "cav-1";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();

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
  // Confidentiality state now reads the generalized signing tables.
  mockPrisma.signingBinding = { findFirst: vi.fn() };
  mockPrisma.signingSignature = { findFirst: vi.fn() };
});

function callPipeline(search = "") {
  return getPipelineData(HIRING_LEAD_ID, new Request(`http://localhost/hiring${search}`));
}

describe("getPipelineData — confidentiality gating", () => {
  it("returns 'unsigned' and empty rows/slices when the user has not signed the bound agreement", async () => {
    mockPrisma.signingBinding.findFirst.mockResolvedValue({ versionId: CAV_ID });
    mockPrisma.signingSignature.findFirst.mockResolvedValue(null);

    const data = await callPipeline();

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
    mockPrisma.signingBinding.findFirst.mockResolvedValue(null);
    mockPrisma.signingSignature.findFirst.mockResolvedValue(null);

    const data = await callPipeline();

    expect(data.confidentialityRequired).toBe("no_agreement");
    expect(data.rows).toEqual([]);
    expect(data.slices).toEqual([]);
    expect(mockPrisma.domainApplication.findMany).not.toHaveBeenCalled();
  });

  it("returns the populated payload when the user has signed the bound agreement", async () => {
    mockPrisma.signingBinding.findFirst.mockResolvedValue({ versionId: CAV_ID });
    mockPrisma.signingSignature.findFirst.mockResolvedValue({ versionId: CAV_ID });
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

    const data = await callPipeline();

    expect(data.confidentialityRequired).toBeNull();
    expect(mockPrisma.domainApplication.findMany).toHaveBeenCalledTimes(1);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].applicantName).toBe("Ada Lovelace");
  });
});
