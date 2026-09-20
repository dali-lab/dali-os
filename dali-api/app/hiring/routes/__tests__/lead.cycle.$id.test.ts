import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");
vi.mock("~/hiring/lib/cycle-applicants.server", () => ({ changeApplicants: vi.fn() }));
vi.mock("~/hiring/lib/cycle-rosters.server", () => ({ addDomainMentors: vi.fn(), domainMentorIds: vi.fn() }));
vi.mock("~/hiring/lib/hiring-emails.server", () => ({ saveHiringEmail: vi.fn(), listHiringEmails: vi.fn() }));
vi.mock("~/hiring/lib/application-form.server", () => ({
  addDomainChallenge: vi.fn(),
  removeDomainChallenge: vi.fn(),
  createCycleApplicationForm: vi.fn(),
}));
vi.mock("~/hiring/lib/cycle-timeline.server", () => ({
  saveCycleTimeline: vi.fn(),
  roundsWithBoards: vi.fn().mockResolvedValue(new Set()),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCycleAdmin } from "~/lib/roles";
import { changeApplicants } from "~/hiring/lib/cycle-applicants.server";
import { addDomainMentors, domainMentorIds } from "~/hiring/lib/cycle-rosters.server";
import { saveHiringEmail } from "~/hiring/lib/hiring-emails.server";
import { addDomainChallenge, removeDomainChallenge } from "~/hiring/lib/application-form.server";
import { saveCycleTimeline } from "~/hiring/lib/cycle-timeline.server";
import { STANDARD_TIMELINE, defaultTimeline } from "~/hiring/lib/cycle-timeline";
import { defaultTimelineFor } from "~/hiring/lib/applicant-groups";
import { action } from "~/hiring/routes/lead.cycle.$id";

const HIRING_LEAD_ID = "hiring-lead-1";
const CYCLE_ID = "cycle-1";
const DOMAIN_ID = "domain-1";
const RV_ID = "rv-1";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user = { findUnique: vi.fn().mockResolvedValue({ id: HIRING_LEAD_ID }) };
  mockPrisma.applicationCycleStatusUpdate = { findFirst: vi.fn(), create: vi.fn().mockResolvedValue({}) };
  mockPrisma.$transaction = vi.fn(async (fn: any) => {
    if (typeof fn === "function") return fn(mockPrisma);
    return Promise.all(fn);
  });
  mockPrisma.domainApplication = { count: vi.fn().mockResolvedValue(0) };
  mockPrisma.rubricVersion = { findUnique: vi.fn() };
  mockPrisma.applicationReview = { count: vi.fn() };
  mockPrisma.domainApplicationCycle = { upsert: vi.fn().mockResolvedValue({}) };
  // The action reads the cycle's applicant group before dispatching intents.
  mockPrisma.applicationCycle = {
    update: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue({ id: CYCLE_ID, applicants: "Students", statusUpdates: [] }),
  };

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: HIRING_LEAD_ID, email: "lead@x.com", type: "user" },
  } as any);
  vi.mocked(isCycleAdmin).mockResolvedValue(true);
});

function makeRequest(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  return new Request(`http://localhost/hiring-lead-admin/cycle/${CYCLE_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

function callAction(form: Record<string, string>) {
  return action({
    request: makeRequest(form),
    params: { id: CYCLE_ID },
    context: {},
  } as any);
}

describe("lead.cycle.$id action — hiring lead overrides", () => {
  it("returns 403 when caller is not a hiring lead", async () => {
    vi.mocked(isCycleAdmin).mockResolvedValueOnce(false);
    const res = await callAction({ intent: "hl-set-domain-rubric", domainId: DOMAIN_ID, rubricVersionId: RV_ID });
    expect(res).not.toBeNull();
    expect((res as Response).status).toBe(403);
  });

  describe("hl-set-domain-rubric", () => {
    it("upserts rubric when no reviews are assigned", async () => {
      mockPrisma.applicationReview.count.mockResolvedValue(0);
      mockPrisma.rubricVersion.findUnique.mockResolvedValue({ id: RV_ID });

      await callAction({ intent: "hl-set-domain-rubric", domainId: DOMAIN_ID, rubricVersionId: RV_ID });

      expect(mockPrisma.domainApplicationCycle.upsert).toHaveBeenCalledWith({
        where: { domainId_applicationCycleId: { domainId: DOMAIN_ID, applicationCycleId: CYCLE_ID } },
        update: { rubricVersionId: RV_ID },
        create: { domainId: DOMAIN_ID, applicationCycleId: CYCLE_ID, rubricVersionId: RV_ID },
      });
    });

    it("is a no-op when reviews already exist for this domain", async () => {
      mockPrisma.applicationReview.count.mockResolvedValue(3);

      await callAction({ intent: "hl-set-domain-rubric", domainId: DOMAIN_ID, rubricVersionId: RV_ID });

      expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
    });
  });

  describe("hl-force-mark-ready / hl-force-unmark-ready", () => {
    it("requires confirm=true to flip ready", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });

      await callAction({ intent: "hl-force-mark-ready", domainId: DOMAIN_ID });

      expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
    });

    it("force-marks ready in Draft", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });

      await callAction({ intent: "hl-force-mark-ready", domainId: DOMAIN_ID, confirm: "true" });

      expect(mockPrisma.domainApplicationCycle.upsert).toHaveBeenCalledWith({
        where: { domainId_applicationCycleId: { domainId: DOMAIN_ID, applicationCycleId: CYCLE_ID } },
        update: { isReady: true },
        create: { domainId: DOMAIN_ID, applicationCycleId: CYCLE_ID, isReady: true },
      });
    });

    it("is a no-op when cycle is past Draft", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });

      await callAction({ intent: "hl-force-mark-ready", domainId: DOMAIN_ID, confirm: "true" });

      expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
    });

    it("force-unmarks ready", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });

      await callAction({ intent: "hl-force-unmark-ready", domainId: DOMAIN_ID, confirm: "true" });

      expect(mockPrisma.domainApplicationCycle.upsert).toHaveBeenCalledWith({
        where: { domainId_applicationCycleId: { domainId: DOMAIN_ID, applicationCycleId: CYCLE_ID } },
        update: { isReady: false },
        create: { domainId: DOMAIN_ID, applicationCycleId: CYCLE_ID, isReady: false },
      });
    });
  });

  describe("set-close-date", () => {
    it("stores the picker date and leaves originalCloseDate null when no extension is active", async () => {
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate: null,
        originalCloseDate: null,
        statusUpdates: [{ newStatus: "Draft" }],
      });

      await callAction({ intent: "set-close-date", closeDate: "2026-06-01" });

      expect(mockPrisma.applicationCycle.update).toHaveBeenCalledTimes(1);
      const updateArgs = mockPrisma.applicationCycle.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: CYCLE_ID });
      expect(updateArgs.data.originalCloseDate).toBeNull();
      expect(updateArgs.data.closeDate).toBeInstanceOf(Date);
    });

    it("preserves the extension delta when picker is moved while extension is active", async () => {
      // Original: 2099-06-01 23:59:59 EDT, currently extended by 48h. Far
      // future so the past-close guard on Open cycles never trips.
      const oldOriginal = new Date("2099-06-02T03:59:59Z");
      const oldClose = new Date(oldOriginal.getTime() + 48 * 3_600_000);
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate: oldClose,
        originalCloseDate: oldOriginal,
        statusUpdates: [{ newStatus: "Open" }],
      });

      await callAction({ intent: "set-close-date", closeDate: "2099-06-05" });

      const updateArgs = mockPrisma.applicationCycle.update.mock.calls[0][0];
      // New original is whatever zonedDayEndUtc(2099, 6, 5, "America/New_York") returns;
      // the close should be that + the preserved 48h delta.
      const newOriginal = updateArgs.data.originalCloseDate as Date;
      const newClose = updateArgs.data.closeDate as Date;
      expect(newOriginal).toBeInstanceOf(Date);
      expect(newClose.getTime() - newOriginal.getTime()).toBe(48 * 3_600_000);
    });

    it("clears originalCloseDate even when the close date is being unset", async () => {
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate: new Date("2026-05-15T23:59:59Z"),
        originalCloseDate: null,
        statusUpdates: [{ newStatus: "Open" }],
      });

      await callAction({ intent: "set-close-date", closeDate: "" });

      expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
        where: { id: CYCLE_ID },
        data: { closeDate: null, originalCloseDate: null },
      });
    });

    it("reopens the cycle when manually setting a future date on a closed cycle", async () => {
      // Cycle that auto-closed (UnderReview materialized). Lead manually
      // re-picks a future date instead of using the Extend button.
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        statusUpdates: [{ newStatus: "UnderReview" }],
      });
      // Pick a date far enough in the future that it's clearly past `Date.now()`
      // regardless of when this test runs.
      const futureYear = new Date().getUTCFullYear() + 1;

      await callAction({ intent: "set-close-date", closeDate: `${futureYear}-06-01` });

      expect(mockPrisma.applicationCycleStatusUpdate.create).toHaveBeenCalledWith({
        data: { applicationCycleId: CYCLE_ID, newStatus: "Open", userId: HIRING_LEAD_ID },
      });
    });

    it("does not reopen on set-close-date when status is already Open", async () => {
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        statusUpdates: [{ newStatus: "Open" }],
      });
      const futureYear = new Date().getUTCFullYear() + 1;

      await callAction({ intent: "set-close-date", closeDate: `${futureYear}-06-01` });

      expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
    });
  });

  describe("extend-close-date", () => {
    it("anchors originalCloseDate to the current close on the first extension", async () => {
      const closeDate = new Date(Date.now() + 86_400_000); // tomorrow
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate,
        originalCloseDate: null,
        statusUpdates: [{ newStatus: "Open" }],
      });

      await callAction({ intent: "extend-close-date", amount: "48", unit: "hours" });

      // Set-total semantics: closeDate = original + 48h (where original is
      // the pre-extension close).
      const expectedClose = new Date(closeDate.getTime() + 48 * 3_600_000);
      expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
        where: { id: CYCLE_ID },
        data: { closeDate: expectedClose, originalCloseDate: closeDate },
      });
      expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
    });

    it("replaces (not stacks) the extension on subsequent calls", async () => {
      // Cycle has original=tomorrow, currently extended by 2 days. Lead saves
      // a new extension of 1 day → final close should be original+1d, not
      // alreadyExtended+1d.
      const original = new Date(Date.now() + 86_400_000);
      const alreadyExtended = new Date(original.getTime() + 2 * 86_400_000);
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate: alreadyExtended,
        originalCloseDate: original,
        statusUpdates: [{ newStatus: "Open" }],
      });

      await callAction({ intent: "extend-close-date", amount: "1", unit: "days" });

      const expectedClose = new Date(original.getTime() + 86_400_000);
      expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
        where: { id: CYCLE_ID },
        data: { closeDate: expectedClose, originalCloseDate: original },
      });
    });

    it("is idempotent — calling extend(48h) twice ends at original+48h, not original+96h", async () => {
      // Common scenario: lead clicks Save extension twice by accident, or
      // re-saves the same extension after a page reload. The result must be
      // the same as one save.
      const original = new Date(Date.now() + 86_400_000);
      const oldClose = new Date(original.getTime() + 48 * 3_600_000);
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate: oldClose,
        originalCloseDate: original,
        statusUpdates: [{ newStatus: "Open" }],
      });

      await callAction({ intent: "extend-close-date", amount: "48", unit: "hours" });

      expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
        where: { id: CYCLE_ID },
        data: { closeDate: oldClose, originalCloseDate: original },
      });
    });

    it("reopens the cycle when extending past now after auto-close", async () => {
      // Cycle that auto-closed yesterday. Lead sets a 48h extension from
      // that past close, which lands in the future — applications reopen.
      const closeDateYesterday = new Date(Date.now() - 86_400_000);
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate: closeDateYesterday,
        originalCloseDate: null,
        statusUpdates: [{ newStatus: "UnderReview" }],
      });

      await callAction({ intent: "extend-close-date", amount: "48", unit: "hours" });

      const expectedClose = new Date(closeDateYesterday.getTime() + 48 * 3_600_000);
      expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
        where: { id: CYCLE_ID },
        data: { closeDate: expectedClose, originalCloseDate: closeDateYesterday },
      });
      expect(mockPrisma.applicationCycleStatusUpdate.create).toHaveBeenCalledWith({
        data: { applicationCycleId: CYCLE_ID, newStatus: "Open", userId: HIRING_LEAD_ID },
      });
    });

    it("does not reopen when the new close date is still in the past", async () => {
      // Lead extends by 1h on a cycle that auto-closed two days ago — the
      // new close is still in the past, no point reopening.
      const longAgo = new Date(Date.now() - 2 * 86_400_000);
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate: longAgo,
        originalCloseDate: null,
        statusUpdates: [{ newStatus: "UnderReview" }],
      });

      await callAction({ intent: "extend-close-date", amount: "1", unit: "hours" });

      expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
    });

    it("rejects non-positive amounts without writing", async () => {
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate: new Date("2026-05-15T23:59:59Z"),
        originalCloseDate: null,
        statusUpdates: [{ newStatus: "Open" }],
      });

      const res = await callAction({ intent: "extend-close-date", amount: "0", unit: "hours" });

      expect((res as Response).status).toBe(400);
      expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
    });

    it("refuses to extend when no close date is set", async () => {
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate: null,
        originalCloseDate: null,
        statusUpdates: [{ newStatus: "Draft" }],
      });

      const res = await callAction({ intent: "extend-close-date", amount: "48", unit: "hours" });

      expect((res as Response).status).toBe(400);
      expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
    });
  });

  describe("remove-extension", () => {
    it("snaps closeDate back to originalCloseDate and clears the marker", async () => {
      const original = new Date("2026-05-15T23:59:59Z");
      const extended = new Date("2026-05-17T23:59:59Z");
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate: extended,
        originalCloseDate: original,
      });

      await callAction({ intent: "remove-extension" });

      expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
        where: { id: CYCLE_ID },
        data: { closeDate: original, originalCloseDate: null, extensionNoticeSentAt: null },
      });
    });

    it("no-ops when no extension is active", async () => {
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate: new Date("2026-05-15T23:59:59Z"),
        originalCloseDate: null,
      });

      await callAction({ intent: "remove-extension" });

      expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
    });
  });

});

describe("lead.cycle.$id action — set-close-date on a live cycle", () => {
  it("rejects a past date while the cycle is Open instead of silently closing it", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({
      id: CYCLE_ID,
      applicants: "Students",
      statusUpdates: [{ newStatus: "Open" }],
    });
    const res = (await callAction({ intent: "set-close-date", closeDate: "2020-01-01" })) as Response;
    expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
    expect(res.headers.get("Location")).toContain("notice=deadline-past");
  });
});

describe("lead.cycle.$id action — set-stages", () => {
  it("updates a stage toggle while the cycle is Draft", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
    await callAction({ intent: "set-stages", stage: "hasChallenges", value: "false" });
    expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
      where: { id: CYCLE_ID },
      data: { hasChallenges: false },
    });
  });

  it("refuses once the cycle has opened", async () => {
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });
    const res = (await callAction({ intent: "set-stages", stage: "hasChallenges", value: "true" })) as Response;
    expect(res.status).toBe(409);
    expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
  });

  it("rejects anything but challenges without writing (rounds live on the timeline)", async () => {
    const res = (await callAction({ intent: "set-stages", stage: "hasInterviews", value: "true" })) as Response;
    expect(res.status).toBe(400);
    expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
  });
});

describe("lead.cycle.$id action — set-confidentiality-agreement", () => {
  beforeEach(() => {
    mockPrisma.signingBinding = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    mockPrisma.signingDocumentVersion = {
      findUnique: vi.fn().mockResolvedValue({ documentId: "doc-1" }),
    };
  });

  it("creates a binding scoped to the cycle when none exists", async () => {
    await callAction({ intent: "set-confidentiality-agreement", confidentialityAgreementVersionId: "ver-1" });
    expect(mockPrisma.signingBinding.create.mock.calls[0][0].data).toEqual({
      documentId: "doc-1",
      versionId: "ver-1",
      scopeKey: `cycle:${CYCLE_ID}`,
      cycleId: CYCLE_ID,
    });
  });

  it("updates the existing binding in place on a rebind", async () => {
    mockPrisma.signingBinding.findFirst.mockResolvedValueOnce({ id: "bind-1" });
    await callAction({ intent: "set-confidentiality-agreement", confidentialityAgreementVersionId: "ver-2" });
    expect(mockPrisma.signingBinding.update.mock.calls[0][0]).toEqual({
      where: { id: "bind-1" },
      data: { versionId: "ver-2", documentId: "doc-1", scopeKey: `cycle:${CYCLE_ID}` },
    });
    expect(mockPrisma.signingBinding.create).not.toHaveBeenCalled();
  });

  it("deletes the binding when the picker is cleared", async () => {
    mockPrisma.signingBinding.findFirst.mockResolvedValueOnce({ id: "bind-1" });
    await callAction({ intent: "set-confidentiality-agreement", confidentialityAgreementVersionId: "" });
    expect(mockPrisma.signingBinding.delete).toHaveBeenCalledWith({ where: { id: "bind-1" } });
  });
});

describe("lead.cycle.$id action — member cycle reviewer pool", () => {
  beforeEach(() => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: CYCLE_ID, applicants: "Interns" });
    mockPrisma.domainApplicationCycle = {
      findMany: vi.fn().mockResolvedValue([{ domainId: "d1" }]),
      createMany: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
    };
    mockPrisma.cycleReviewer = {
      findMany: vi.fn().mockResolvedValue([{ userId: "u1" }]),
      createMany: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
    };
    mockPrisma.domainApplication = { findFirst: vi.fn().mockResolvedValue(null) };
  });

  it("adds existing pool members to a newly targeted domain", async () => {
    await callAction({ intent: "set-target-domains", domainIds: JSON.stringify(["d1", "d2"]) });
    expect(mockPrisma.domainApplicationCycle.createMany).toHaveBeenCalledWith({
      data: [{ applicationCycleId: CYCLE_ID, domainId: "d2" }],
    });
    expect(mockPrisma.cycleReviewer.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u1", applicationCycleId: CYCLE_ID, domainId: "d2" }],
      skipDuplicates: true,
    });
  });

  it("won't drop a domain applicants already picked", async () => {
    mockPrisma.domainApplication.findFirst.mockResolvedValue({ id: "da-1" });
    const res = (await callAction({ intent: "set-target-domains", domainIds: "[]" })) as Response;
    expect(res.status).toBe(409);
    expect(mockPrisma.domainApplicationCycle.deleteMany).not.toHaveBeenCalled();
  });

  it("puts a new pool member on every domain", async () => {
    await callAction({ intent: "add-reviewer-pool", userId: "u2" });
    expect(mockPrisma.cycleReviewer.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u2", applicationCycleId: CYCLE_ID, domainId: "d1" }],
      skipDuplicates: true,
    });
  });

  it("only resets to default reviewers on Lab members cycles", async () => {
    const res = (await callAction({ intent: "reset-default-reviewers" })) as Response;
    expect(res.status).toBe(400);
    expect(mockPrisma.cycleReviewer.deleteMany).not.toHaveBeenCalled();
  });

  it("ignores pool intents on Students cycles", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ id: CYCLE_ID, applicants: "Students" });
    await callAction({ intent: "add-reviewer-pool", userId: "u2" });
    expect(mockPrisma.cycleReviewer.createMany).not.toHaveBeenCalled();
  });
});

describe("lead.cycle.$id action — set-applicants", () => {
  it("changes the group, passing whether the actor is an Admin", async () => {
    vi.mocked(isAdmin).mockResolvedValue(true);
    vi.mocked(changeApplicants).mockResolvedValue(null);
    const res = (await callAction({ intent: "set-applicants", applicants: "LabMembers" })) as Response;
    expect(changeApplicants).toHaveBeenCalledWith(CYCLE_ID, "LabMembers", true);
    expect(res.headers.get("Location")).toContain("notice=applicants-changed");
  });

  it("returns 409 once the cycle has opened", async () => {
    vi.mocked(changeApplicants).mockResolvedValue("not-draft");
    const res = (await callAction({ intent: "set-applicants", applicants: "Interns" })) as Response;
    expect(res.status).toBe(409);
  });

  it("returns 403 when a non-admin touches Lab members", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    vi.mocked(changeApplicants).mockResolvedValue("admin-only");
    const res = (await callAction({ intent: "set-applicants", applicants: "LabMembers" })) as Response;
    expect(res.status).toBe(403);
  });

  it("rejects an unknown group without calling the helper", async () => {
    const res = (await callAction({ intent: "set-applicants", applicants: "Everyone" })) as Response;
    expect(res.status).toBe(400);
    expect(changeApplicants).not.toHaveBeenCalled();
  });
});

describe("lead.cycle.$id action — set-timeline", () => {
  const post = (timeline: unknown) => callAction({ intent: "set-timeline", timeline: JSON.stringify(timeline) });
  const status = (newStatus: string) =>
    mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus });

  beforeEach(() => {
    mockPrisma.applicationCycle.findUnique.mockImplementation(({ select }: any) =>
      Promise.resolve(
        select?.timeline ? { timeline: STANDARD_TIMELINE } : { id: CYCLE_ID, applicants: "Students" },
      ),
    );
    vi.mocked(saveCycleTimeline).mockResolvedValue(null);
    status("Draft");
  });

  it("saves a valid timeline", async () => {
    const moved = STANDARD_TIMELINE.map((b) => (b.kind === "phase" && b.key === "decisions" ? { ...b, weeks: [10, 10] } : b));
    const res = (await post(moved)) as Response;
    expect(saveCycleTimeline).toHaveBeenCalledWith(CYCLE_ID, moved);
    expect(res.headers.get("Location")).toContain("notice=timeline-saved");
  });

  it("returns 400 with the reason for an invalid timeline", async () => {
    const noRounds = STANDARD_TIMELINE.filter((b) => b.kind !== "delib" && !(b.kind === "phase" && b.key === "interviews"));
    const res = (await post(noRounds)) as Response;
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/delib round/);
    expect(saveCycleTimeline).not.toHaveBeenCalled();
  });

  it("allows moving weeks after the cycle opens", async () => {
    status("Open");
    const moved = STANDARD_TIMELINE.map((b) => (b.kind === "delib" ? { ...b, label: `${b.label}!` } : b));
    await post(moved);
    expect(saveCycleTimeline).toHaveBeenCalled();
  });

  it("returns 409 on adding or removing blocks after the cycle opens", async () => {
    status("Open");
    const withoutInterviews = defaultTimeline({ firstDelib: true, interviews: false });
    const res = (await post(withoutInterviews)) as Response;
    expect(res.status).toBe(409);
    expect(saveCycleTimeline).not.toHaveBeenCalled();
  });

  it("resets to the audience's default", async () => {
    const res = (await callAction({ intent: "set-timeline", reset: "1" })) as Response;
    expect(saveCycleTimeline).toHaveBeenCalledWith(CYCLE_ID, defaultTimelineFor("Students"));
    expect(res.headers.get("Location")).toContain("notice=timeline-reset");
  });

  it("passes on the saver's refusal (e.g. dropping a round with a board)", async () => {
    vi.mocked(saveCycleTimeline).mockResolvedValue("First delib already has a board, so it can't be removed.");
    const res = (await post(STANDARD_TIMELINE)) as Response;
    expect(res.status).toBe(400);
  });
});

describe("lead.cycle.$id action — domain challenges", () => {
  it("adds a challenge to the domain in Draft", async () => {
    vi.mocked(addDomainChallenge).mockResolvedValue(null);
    const res = (await callAction({ intent: "create-challenge-form", domainId: DOMAIN_ID })) as Response;
    expect(addDomainChallenge).toHaveBeenCalledWith(CYCLE_ID, DOMAIN_ID, HIRING_LEAD_ID);
    expect(res.status).toBe(302);
  });

  it("refuses once the cycle has opened", async () => {
    vi.mocked(addDomainChallenge).mockResolvedValue("not-draft");
    const res = (await callAction({ intent: "create-challenge-form", domainId: DOMAIN_ID })) as Response;
    expect(res.status).toBe(409);
  });

  it("removes only links on this cycle, and not once picked", async () => {
    vi.mocked(removeDomainChallenge).mockResolvedValue("in-use");
    const res = (await callAction({ intent: "remove-challenge-form", cdfId: "cdf-1" })) as Response;
    expect(removeDomainChallenge).toHaveBeenCalledWith("cdf-1", CYCLE_ID);
    expect(res.status).toBe(409);
  });
});

describe("lead.cycle.$id action — add-domain-mentors", () => {
  beforeEach(() => {
    mockPrisma.domainApplicationCycle.findUnique = vi.fn().mockResolvedValue({ domainId: DOMAIN_ID });
  });

  it("adds the domain's mentors to the chosen roster", async () => {
    vi.mocked(addDomainMentors).mockResolvedValue(3);
    const res = (await callAction({ intent: "add-domain-mentors", role: "reviewer", domainId: DOMAIN_ID })) as Response;
    expect(addDomainMentors).toHaveBeenCalledWith(CYCLE_ID, DOMAIN_ID, "reviewer", expect.any(Request));
    expect(res.headers.get("Location")).toContain("notice=mentors-added");
    expect(res.headers.get("Location")).toContain("added=3");
  });

  it("says when everyone was already there, or there are no mentors", async () => {
    vi.mocked(addDomainMentors).mockResolvedValue(0);
    vi.mocked(domainMentorIds).mockResolvedValueOnce(["u1"]);
    let res = (await callAction({ intent: "add-domain-mentors", role: "interviewer", domainId: DOMAIN_ID })) as Response;
    expect(res.headers.get("Location")).toContain("notice=mentors-already");
    vi.mocked(domainMentorIds).mockResolvedValueOnce([]);
    res = (await callAction({ intent: "add-domain-mentors", role: "interviewer", domainId: DOMAIN_ID })) as Response;
    expect(res.headers.get("Location")).toContain("notice=mentors-none");
  });

  it("rejects a domain that isn't in the cycle", async () => {
    mockPrisma.domainApplicationCycle.findUnique.mockResolvedValue(null);
    const res = (await callAction({ intent: "add-domain-mentors", role: "reviewer", domainId: "elsewhere" })) as Response;
    expect(res.status).toBe(400);
    expect(addDomainMentors).not.toHaveBeenCalled();
  });

  it("rejects an unknown roster", async () => {
    const res = (await callAction({ intent: "add-domain-mentors", role: "judge", domainId: DOMAIN_ID })) as Response;
    expect(res.status).toBe(400);
    expect(addDomainMentors).not.toHaveBeenCalled();
  });
});

describe("lead.cycle.$id action — save-hiring-email", () => {
  it("saves a slot's shared email", async () => {
    const res = await callAction({
      intent: "save-hiring-email",
      slot: "notification:ApplicationExtensionNotice",
      subject: "More time",
      body: "Hi {{firstName}}",
    });
    expect(saveHiringEmail).toHaveBeenCalledWith(
      "notification:ApplicationExtensionNotice",
      { subject: "More time", body: "Hi {{firstName}}" },
      HIRING_LEAD_ID,
    );
    expect(res).toEqual({ ok: true });
  });

  it("passes an empty email through, which turns the slot off", async () => {
    await callAction({ intent: "save-hiring-email", slot: "decision:Rejected", subject: "", body: "" });
    expect(saveHiringEmail).toHaveBeenCalledWith("decision:Rejected", { subject: "", body: "" }, HIRING_LEAD_ID);
  });

  it("rejects an unknown slot", async () => {
    const res = (await callAction({ intent: "save-hiring-email", slot: "decision:Promoted", subject: "x", body: "y" })) as Response;
    expect(res.status).toBe(400);
    expect(saveHiringEmail).not.toHaveBeenCalled();
  });
});

describe("lead.cycle.$id action — set-term", () => {
  beforeEach(() => {
    // 26F starts Monday 2026-09-14 (a UTC-midnight calendar stamp).
    mockPrisma.term = { findUnique: vi.fn().mockResolvedValue({ startDate: new Date("2026-09-14T00:00:00Z") }) };
  });

  it("fills an unset window with Weeks 4 to 5 of the term", async () => {
    mockPrisma.applicationCycle.findUnique
      .mockResolvedValueOnce({ id: CYCLE_ID, applicants: "Students" })
      .mockResolvedValueOnce({ openDate: null, closeDate: null });
    await callAction({ intent: "set-term", termId: "term-26f" });
    const { data } = mockPrisma.applicationCycle.update.mock.calls[0][0];
    expect(data.termId).toBe("term-26f");
    // Week 4 starts Oct 5: midnight EDT is 04:00Z.
    expect((data.openDate as Date).toISOString()).toBe("2026-10-05T04:00:00.000Z");
    // Week 5 ends Sunday Oct 18: 11:59:59 PM EDT.
    expect((data.closeDate as Date).toISOString()).toBe("2026-10-19T03:59:59.000Z");
  });

  it("keeps dates a lead already chose", async () => {
    mockPrisma.applicationCycle.findUnique
      .mockResolvedValueOnce({ id: CYCLE_ID, applicants: "Students" })
      .mockResolvedValueOnce({ openDate: null, closeDate: new Date("2026-10-30T03:59:59Z") });
    await callAction({ intent: "set-term", termId: "term-26f" });
    expect(mockPrisma.applicationCycle.update.mock.calls[0][0].data).toEqual({ termId: "term-26f" });
  });

  it("rejects an unknown term", async () => {
    mockPrisma.term.findUnique.mockResolvedValue(null);
    const res = (await callAction({ intent: "set-term", termId: "nope" })) as Response;
    expect(res.status).toBe(400);
    expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
  });
});

describe("lead.cycle.$id action — set-open-date", () => {
  it("stores the start of that day in Eastern time", async () => {
    await callAction({ intent: "set-open-date", openDate: "2099-06-01" });
    expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
      where: { id: CYCLE_ID },
      data: { openDate: new Date("2099-06-01T04:00:00.000Z") },
    });
  });

  it("clears the open date when empty", async () => {
    await callAction({ intent: "set-open-date", openDate: "" });
    expect(mockPrisma.applicationCycle.update.mock.calls[0][0].data).toEqual({ openDate: null });
  });
});

describe("lead.cycle.$id action — save-term-dates (one Save for the card)", () => {
  // Existing: 26F, opens Oct 5, closes Oct 18 (11:59:59 PM EDT).
  const before = (status: string) => ({
    termId: "term-26f",
    openDate: new Date("2026-10-05T04:00:00Z"),
    closeDate: new Date("2026-10-19T03:59:59Z"),
    originalCloseDate: null,
    statusUpdates: [{ newStatus: status }],
  });
  beforeEach(() => {
    mockPrisma.term = { findUnique: vi.fn().mockResolvedValue({ startDate: new Date("2026-09-14T00:00:00Z") }) };
  });

  it("saves only the term when the dates didn't change", async () => {
    mockPrisma.applicationCycle.findUniqueOrThrow = vi.fn().mockResolvedValue(before("Draft"));
    await callAction({ intent: "save-term-dates", termId: "term-27w", openDate: "2026-10-05", closeDate: "2026-10-18" });
    const datas = mockPrisma.applicationCycle.update.mock.calls.map((c: any) => c[0].data);
    expect(datas).toEqual([{ termId: "term-27w" }]);
  });

  it("saves a changed open date with the term", async () => {
    mockPrisma.applicationCycle.findUniqueOrThrow = vi.fn().mockResolvedValue(before("Draft"));
    await callAction({ intent: "save-term-dates", termId: "term-26f", openDate: "2026-10-07", closeDate: "2026-10-18" });
    const datas = mockPrisma.applicationCycle.update.mock.calls.map((c: any) => c[0].data);
    expect(datas).toEqual([{ termId: "term-26f" }, { openDate: new Date("2026-10-07T04:00:00.000Z") }]);
  });

  it("leaves the open date alone once applications have opened", async () => {
    mockPrisma.applicationCycle.findUniqueOrThrow = vi.fn().mockResolvedValue(before("Open"));
    await callAction({ intent: "save-term-dates", termId: "term-26f", openDate: "2026-10-07", closeDate: "2026-10-18" });
    const datas = mockPrisma.applicationCycle.update.mock.calls.map((c: any) => c[0].data);
    expect(datas).toEqual([{ termId: "term-26f" }]);
  });
});
