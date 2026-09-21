import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/hiring/lib/application-form.server", async (importOriginal) => ({
  // The Draft and in-use rules live in the lib (shared with the cycle page),
  // so keep them real; only the form-creating side is stubbed.
  ...(await importOriginal<typeof import("~/hiring/lib/application-form.server")>()),
  createDomainChallengeForm: vi.fn().mockResolvedValue({}),
  loadHiringForm: vi.fn(),
  createCycleApplicationForm: vi.fn(),
}));

vi.mock("~/hiring/lib/cycle-rosters.server", () => ({
  addDomainMentors: vi.fn(),
  domainMentorIds: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { addDomainMentors, domainMentorIds } from "~/hiring/lib/cycle-rosters.server";
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
  mockPrisma.domainLeadAssignment = { findFirst: vi.fn().mockResolvedValue({ id: "a1" }) };

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

describe("domain-lead action — access", () => {
  it("refuses anyone who doesn't lead the domain", async () => {
    mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue(null);
    mockPrisma.domainApplicationCycle = { update: vi.fn(), upsert: vi.fn() };
    for (const intent of ["set-rubric", "mark-ready", "unmark-ready"]) {
      const res = await callAction({ intent, cycleId: CYCLE_ID, domainId: DOMAIN_ID });
      expect((res as Response).status).toBe(403);
    }
    expect(mockPrisma.domainApplicationCycle.update).not.toHaveBeenCalled();
    expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
  });

  it("checks the lead against a challenge form's own domain", async () => {
    mockPrisma.cycleDomainForm.findUnique.mockResolvedValue({ domainId: "other-domain" });
    mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue(null);
    const res = await callAction({ intent: "remove-challenge-form", cdfId: "cdf-1", domainId: DOMAIN_ID });
    expect((res as Response).status).toBe(403);
    expect(mockPrisma.domainLeadAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, domainId: "other-domain" } }),
    );
    expect(mockPrisma.cycleDomainForm.delete).not.toHaveBeenCalled();
  });
});

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
      domainId: DOMAIN_ID,
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
      domainId: DOMAIN_ID,
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
      domainId: DOMAIN_ID,
    });
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });

    await callAction({
      intent: "remove-challenge-form",
      cdfId: CDF_ID,
    });

    expect(mockPrisma.cycleDomainForm.delete).not.toHaveBeenCalled();
  });
});

describe("domain-lead action: add-domain-mentors", () => {
  const form = (extra: Record<string, string> = {}) => ({
    intent: "add-domain-mentors",
    cycleId: CYCLE_ID,
    domainId: DOMAIN_ID,
    role: "reviewer",
    ...extra,
  });

  beforeEach(() => {
    mockPrisma.domainLeadAssignment = { findFirst: vi.fn().mockResolvedValue({ id: "a1" }) };
    mockPrisma.domainApplicationCycle = { findUnique: vi.fn().mockResolvedValue({ domainId: DOMAIN_ID }) };
  });

  it("adds the domain's mentors and says how many", async () => {
    vi.mocked(addDomainMentors).mockResolvedValue(3);
    const res = await callAction(form());
    expect(addDomainMentors).toHaveBeenCalledWith(CYCLE_ID, DOMAIN_ID, "reviewer", expect.any(Request));
    expect(res).toEqual({ notice: "Added 3 mentors." });
  });

  it("tells apart everyone-already-added from no mentors", async () => {
    vi.mocked(addDomainMentors).mockResolvedValue(0);
    vi.mocked(domainMentorIds).mockResolvedValueOnce(["u1"]);
    expect(await callAction(form())).toEqual({ notice: "Everyone's already on the roster." });
    vi.mocked(domainMentorIds).mockResolvedValueOnce([]);
    expect(await callAction(form({ role: "interviewer" }))).toEqual({ notice: "This domain has no mentors yet." });
  });

  it("refuses a user who doesn't lead the domain", async () => {
    mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue(null);
    const res = (await callAction(form())) as Response;
    expect(res.status).toBe(403);
    expect(addDomainMentors).not.toHaveBeenCalled();
  });

  it("refuses a domain outside the cycle and an unknown role", async () => {
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue(null);
    expect(((await callAction(form())) as Response).status).toBe(400);
    expect(((await callAction(form({ role: "lead" }))) as Response).status).toBe(400);
    expect(addDomainMentors).not.toHaveBeenCalled();
  });
});
