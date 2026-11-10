import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
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

import { prisma } from "~/lib/db.server";
import { addDomainMentors, domainMentorIds } from "~/hiring/lib/cycle-rosters.server";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
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
  // The domain is live (ready) unless a test stages it.
  mockPrisma.domainApplicationCycle = {
    findUnique: vi.fn().mockResolvedValue({ isReady: true }),
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn(),
  };
  mockPrisma.applicationCycle = { findUnique: vi.fn().mockResolvedValue({ hasChallenges: true }) };

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
  it("links the form the lead picked", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
    mockPrisma.form = { findUnique: vi.fn().mockResolvedValue({ id: "form-1" }) };
    mockPrisma.cycleDomainForm.upsert = vi.fn();

    await callAction({ intent: "create-challenge-form", cycleId: CYCLE_ID, domainId: DOMAIN_ID, formId: "form-1" });

    expect(mockPrisma.cycleDomainForm.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { applicationCycleId: CYCLE_ID, domainId: DOMAIN_ID, formId: "form-1" },
      }),
    );
  });

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

describe("domain-lead action — mark-ready in an Open cycle", () => {
  const status = (newStatus: string) =>
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus });

  it("publishes a staged domain once its challenge form is linked", async () => {
    status("Open");
    mockPrisma.cycleDomainForm.count = vi.fn().mockResolvedValue(1);

    const res = await callAction({ intent: "mark-ready", cycleId: CYCLE_ID, domainId: DOMAIN_ID });

    expect(mockPrisma.domainApplicationCycle.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { isReady: true } }),
    );
    expect((res as Response).status).toBe(302);
  });

  it("refuses to publish a staged domain with no challenge form", async () => {
    status("Open");
    mockPrisma.cycleDomainForm.count = vi.fn().mockResolvedValue(0);

    const res = await callAction({ intent: "mark-ready", cycleId: CYCLE_ID, domainId: DOMAIN_ID });

    expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
    expect((res as { error?: string }).error).toMatch(/challenge form/);
  });

  it("never unmarks a domain while the cycle is open", async () => {
    status("Open");

    const res = await callAction({ intent: "unmark-ready", cycleId: CYCLE_ID, domainId: DOMAIN_ID });

    expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
    expect((res as { error?: string }).error).toBeTruthy();
  });

  it("refuses both once review has started", async () => {
    status("UnderReview");
    mockPrisma.cycleDomainForm.count = vi.fn().mockResolvedValue(1);

    await callAction({ intent: "mark-ready", cycleId: CYCLE_ID, domainId: DOMAIN_ID });
    await callAction({ intent: "unmark-ready", cycleId: CYCLE_ID, domainId: DOMAIN_ID });

    expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
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
    expect(addDomainMentors).toHaveBeenCalledWith(CYCLE_ID, DOMAIN_ID, "reviewer", expect.any(Request), undefined, USER_ID);
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

describe("domain-lead action — audit trail", () => {
  const status = (newStatus: string) =>
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus });
  const logged = () => vi.mocked(logAuditEvent).mock.calls.map(([e]) => [e.action, e.userId, e.targetId, e.metadata]);

  it("logs marking and unmarking a domain ready in Draft", async () => {
    status("Draft");

    await callAction({ intent: "mark-ready", cycleId: CYCLE_ID, domainId: DOMAIN_ID });
    await callAction({ intent: "unmark-ready", cycleId: CYCLE_ID, domainId: DOMAIN_ID });

    expect(logged()).toEqual([
      ["domain.ready.set", USER_ID, DOMAIN_ID, { cycleId: CYCLE_ID, ready: true }],
      ["domain.ready.set", USER_ID, DOMAIN_ID, { cycleId: CYCLE_ID, ready: false }],
    ]);
  });

  it("logs nothing when the ready change is refused", async () => {
    status("Open");
    await callAction({ intent: "unmark-ready", cycleId: CYCLE_ID, domainId: DOMAIN_ID });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("logs the rubric change with the version before and after", async () => {
    mockPrisma.applicationReview = { count: vi.fn().mockResolvedValue(0) };
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue({ rubricVersionId: "rv-old" });

    await callAction({ intent: "set-rubric", cycleId: CYCLE_ID, domainId: DOMAIN_ID, rubricVersionId: "rv-new" });

    expect(logged()).toEqual([
      ["domain.rubric.set", USER_ID, DOMAIN_ID, { cycleId: CYCLE_ID, before: "rv-old", after: "rv-new" }],
    ]);
  });

  it("logs nothing when reviews already exist and the rubric is locked", async () => {
    mockPrisma.applicationReview = { count: vi.fn().mockResolvedValue(2) };
    await callAction({ intent: "set-rubric", cycleId: CYCLE_ID, domainId: DOMAIN_ID, rubricVersionId: "rv-new" });
    expect(mockPrisma.domainApplicationCycle.update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("logs linking a picked challenge form, and not a refused link", async () => {
    mockPrisma.form = { findUnique: vi.fn().mockResolvedValue({ id: "form-1" }) };
    mockPrisma.cycleDomainForm.upsert = vi.fn();
    status("Draft");
    await callAction({ intent: "create-challenge-form", cycleId: CYCLE_ID, domainId: DOMAIN_ID, formId: "form-1" });
    status("Open");
    await callAction({ intent: "create-challenge-form", cycleId: CYCLE_ID, domainId: DOMAIN_ID, formId: "form-1" });

    expect(logged()).toEqual([
      ["domain.challenge-form.add", USER_ID, DOMAIN_ID, { cycleId: CYCLE_ID, formId: "form-1", created: false }],
    ]);
  });

  it("logs removing a challenge form with its cycle and form", async () => {
    mockPrisma.cycleDomainForm.findUnique.mockResolvedValue({
      id: "cdf-1",
      formId: "form-1",
      applicationCycleId: CYCLE_ID,
      domainId: DOMAIN_ID,
    });
    status("Draft");

    await callAction({ intent: "remove-challenge-form", cdfId: "cdf-1" });

    expect(logged()).toEqual([
      ["domain.challenge-form.remove", USER_ID, DOMAIN_ID, { cycleId: CYCLE_ID, formId: "form-1" }],
    ]);
  });

  it("logs nothing when a challenge form removal is refused", async () => {
    mockPrisma.cycleDomainForm.findUnique.mockResolvedValue({
      id: "cdf-1",
      formId: "form-1",
      applicationCycleId: CYCLE_ID,
      domainId: DOMAIN_ID,
    });
    status("Draft");
    mockPrisma.domainApplication.count.mockResolvedValue(1);

    await callAction({ intent: "remove-challenge-form", cdfId: "cdf-1" });

    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("leaves the mentor-roster row to the shared roster function, so the route never logs it too", async () => {
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue({ domainId: DOMAIN_ID });
    vi.mocked(addDomainMentors).mockResolvedValue(2);

    await callAction({ intent: "add-domain-mentors", cycleId: CYCLE_ID, domainId: DOMAIN_ID, role: "interviewer" });

    expect(addDomainMentors).toHaveBeenCalledWith(CYCLE_ID, DOMAIN_ID, "interviewer", expect.any(Request), undefined, USER_ID);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("logs nothing for someone who does not lead the domain", async () => {
    mockPrisma.domainLeadAssignment.findFirst.mockResolvedValue(null);
    await callAction({ intent: "mark-ready", cycleId: CYCLE_ID, domainId: DOMAIN_ID });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
