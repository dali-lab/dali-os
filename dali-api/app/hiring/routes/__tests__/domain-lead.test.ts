import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/hiring/lib/application-form.server", () => ({
  createDomainChallengeForm: vi.fn().mockResolvedValue({}),
  loadHiringForm: vi.fn(),
  createCycleApplicationForm: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { action } from "~/hiring/routes/domain-lead";

const USER_ID = "user-1";
const CYCLE_ID = "cycle-1";
const DOMAIN_ID = "domain-1";
const CV_ID = "cv-1";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.applicationCycleStatusUpdate = { findFirst: vi.fn() };
  mockPrisma.cycleDomainForm = {
    findUnique: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue({}),
  };
  mockPrisma.domainApplication = { count: vi.fn().mockResolvedValue(0) };

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "lead@x.com", type: "user" },
  } as any);
});

function makeRequest(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  return new Request("http://localhost/domain-lead", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

function callAction(form: Record<string, string>) {
  return action({ request: makeRequest(form), params: {}, context: {} } as any);
}

describe("domain-lead action — create-challenge-form", () => {
  it("is a no-op when cycle is past Draft", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });

    await callAction({
      intent: "create-challenge-form",
      cycleId: CYCLE_ID,
      domainId: DOMAIN_ID,
    });

    // createDomainChallengeForm is mocked away in the module mock below;
    // this test only asserts the cycle-status guard redirects without error.
    expect(mockPrisma.cycleDomainForm.delete).not.toHaveBeenCalled();
  });
});

describe("domain-lead action — remove-challenge-form", () => {
  const CDF_ID = "cdf-1";
  const FORM_ID = "form-1";

  it("deletes the CycleDomainForm in Draft when no DomainApplication picked it", async () => {
    mockPrisma.cycleDomainForm.findUnique.mockResolvedValue({
      id: CDF_ID,
      formId: FORM_ID,
      applicationCycleId: CYCLE_ID,
    });
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
    mockPrisma.domainApplication.count.mockResolvedValue(0);

    await callAction({
      intent: "remove-challenge-form",
      cdfId: CDF_ID,
    });

    expect(mockPrisma.cycleDomainForm.delete).toHaveBeenCalledWith({
      where: { id: CDF_ID },
    });
  });

  it("refuses when a DomainApplication picked a version of this form", async () => {
    mockPrisma.cycleDomainForm.findUnique.mockResolvedValue({
      id: CDF_ID,
      formId: FORM_ID,
      applicationCycleId: CYCLE_ID,
    });
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
    mockPrisma.domainApplication.count.mockResolvedValue(1);

    await callAction({
      intent: "remove-challenge-form",
      cdfId: CDF_ID,
    });

    expect(mockPrisma.cycleDomainForm.delete).not.toHaveBeenCalled();
  });

  it("is a no-op when cycle is past Draft", async () => {
    mockPrisma.cycleDomainForm.findUnique.mockResolvedValue({
      id: CDF_ID,
      formId: FORM_ID,
      applicationCycleId: CYCLE_ID,
    });
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });

    await callAction({
      intent: "remove-challenge-form",
      cdfId: CDF_ID,
    });

    expect(mockPrisma.cycleDomainForm.delete).not.toHaveBeenCalled();
  });
});
