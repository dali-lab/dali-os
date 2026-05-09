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
import { action } from "~/hiring/routes/lead.cycle.$id";

const HIRING_LEAD_ID = "hiring-lead-1";
const CYCLE_ID = "cycle-1";
const DOMAIN_ID = "domain-1";
const CV_ID = "cv-1";
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
  mockPrisma.challengeVersion = { findUnique: vi.fn() };
  mockPrisma.challengeVersionApplicationCycle = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    count: vi.fn(),
  };
  mockPrisma.domainApplication = { count: vi.fn().mockResolvedValue(0) };
  mockPrisma.rubricVersion = { findUnique: vi.fn() };
  mockPrisma.applicationReview = { count: vi.fn() };
  mockPrisma.domainApplicationCycle = { upsert: vi.fn().mockResolvedValue({}) };
  mockPrisma.applicationCycle = {
    update: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn(),
  };

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: HIRING_LEAD_ID, email: "lead@x.com", type: "user" },
  } as any);
  vi.mocked(isHiringLead).mockResolvedValue(true);
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

describe("admin.cycle.$id action — hiring lead overrides", () => {
  it("returns 403 when caller is not a hiring lead", async () => {
    vi.mocked(isHiringLead).mockResolvedValueOnce(false);
    const res = await callAction({ intent: "hl-add-domain-challenge", domainId: DOMAIN_ID, challengeVersionId: CV_ID });
    expect(res).not.toBeNull();
    expect((res as Response).status).toBe(403);
    expect(mockPrisma.challengeVersionApplicationCycle.create).not.toHaveBeenCalled();
  });

  describe("hl-add-domain-challenge", () => {
    it("links the challenge version in Draft", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
      mockPrisma.challengeVersion.findUnique.mockResolvedValue({ id: CV_ID, domainId: DOMAIN_ID });
      mockPrisma.challengeVersionApplicationCycle.findUnique.mockResolvedValue(null);

      await callAction({ intent: "hl-add-domain-challenge", domainId: DOMAIN_ID, challengeVersionId: CV_ID });

      expect(mockPrisma.challengeVersionApplicationCycle.create).toHaveBeenCalledWith({
        data: { challengeVersionId: CV_ID, applicationCycleId: CYCLE_ID },
      });
    });

    it("does not delete sibling challenges (multi-challenge support)", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
      mockPrisma.challengeVersion.findUnique.mockResolvedValue({ id: CV_ID, domainId: DOMAIN_ID });
      mockPrisma.challengeVersionApplicationCycle.findUnique.mockResolvedValue(null);

      await callAction({ intent: "hl-add-domain-challenge", domainId: DOMAIN_ID, challengeVersionId: CV_ID });

      expect(mockPrisma.challengeVersionApplicationCycle.deleteMany).not.toHaveBeenCalled();
    });

    it("is idempotent — skips create when already linked", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
      mockPrisma.challengeVersion.findUnique.mockResolvedValue({ id: CV_ID, domainId: DOMAIN_ID });
      mockPrisma.challengeVersionApplicationCycle.findUnique.mockResolvedValue({
        challengeVersionId: CV_ID,
        applicationCycleId: CYCLE_ID,
      });

      await callAction({ intent: "hl-add-domain-challenge", domainId: DOMAIN_ID, challengeVersionId: CV_ID });

      expect(mockPrisma.challengeVersionApplicationCycle.create).not.toHaveBeenCalled();
    });

    it("is a no-op when cycle is past Draft", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });
      mockPrisma.challengeVersion.findUnique.mockResolvedValue({ id: CV_ID, domainId: DOMAIN_ID });

      await callAction({ intent: "hl-add-domain-challenge", domainId: DOMAIN_ID, challengeVersionId: CV_ID });

      expect(mockPrisma.challengeVersionApplicationCycle.create).not.toHaveBeenCalled();
    });

    it("rejects a challenge version that does not belong to the named domain", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
      mockPrisma.challengeVersion.findUnique.mockResolvedValue({ id: CV_ID, domainId: "other-domain" });

      await callAction({ intent: "hl-add-domain-challenge", domainId: DOMAIN_ID, challengeVersionId: CV_ID });

      expect(mockPrisma.challengeVersionApplicationCycle.create).not.toHaveBeenCalled();
    });

    it("refuses to link a second version of the same underlying challenge", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
      mockPrisma.challengeVersion.findUnique.mockResolvedValue({ id: CV_ID, domainId: DOMAIN_ID, challengeId: "challenge-1" });
      mockPrisma.challengeVersionApplicationCycle.findFirst.mockResolvedValue({
        challengeVersionId: "cv-other-version",
        applicationCycleId: CYCLE_ID,
      });

      await callAction({ intent: "hl-add-domain-challenge", domainId: DOMAIN_ID, challengeVersionId: CV_ID });

      expect(mockPrisma.challengeVersionApplicationCycle.create).not.toHaveBeenCalled();
    });
  });

  describe("hl-remove-domain-challenge", () => {
    it("unlinks a CV in Draft when no DomainApplication references it", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
      mockPrisma.domainApplication.count.mockResolvedValue(0);

      await callAction({ intent: "hl-remove-domain-challenge", challengeVersionId: CV_ID });

      expect(mockPrisma.challengeVersionApplicationCycle.deleteMany).toHaveBeenCalledWith({
        where: { challengeVersionId: CV_ID, applicationCycleId: CYCLE_ID },
      });
    });

    it("refuses to unlink when a DomainApplication picked this CV", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
      mockPrisma.domainApplication.count.mockResolvedValue(1);

      await callAction({ intent: "hl-remove-domain-challenge", challengeVersionId: CV_ID });

      expect(mockPrisma.challengeVersionApplicationCycle.deleteMany).not.toHaveBeenCalled();
    });

    it("is a no-op when cycle is past Draft", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });

      await callAction({ intent: "hl-remove-domain-challenge", challengeVersionId: CV_ID });

      expect(mockPrisma.challengeVersionApplicationCycle.deleteMany).not.toHaveBeenCalled();
    });
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
      mockPrisma.challengeVersionApplicationCycle.count.mockResolvedValue(1);

      await callAction({ intent: "hl-force-mark-ready", domainId: DOMAIN_ID });

      expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
    });

    it("force-marks ready in Draft when a challenge is linked", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
      mockPrisma.challengeVersionApplicationCycle.count.mockResolvedValue(1);

      await callAction({ intent: "hl-force-mark-ready", domainId: DOMAIN_ID, confirm: "true" });

      expect(mockPrisma.domainApplicationCycle.upsert).toHaveBeenCalledWith({
        where: { domainId_applicationCycleId: { domainId: DOMAIN_ID, applicationCycleId: CYCLE_ID } },
        update: { isReady: true },
        create: { domainId: DOMAIN_ID, applicationCycleId: CYCLE_ID, isReady: true },
      });
    });

    it("refuses to force-mark ready when no challenge is linked for the domain", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });
      mockPrisma.challengeVersionApplicationCycle.count.mockResolvedValue(0);

      await callAction({ intent: "hl-force-mark-ready", domainId: DOMAIN_ID, confirm: "true" });

      expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
    });

    it("is a no-op when cycle is past Draft", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });

      await callAction({ intent: "hl-force-mark-ready", domainId: DOMAIN_ID, confirm: "true" });

      expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
    });

    it("force-unmarks ready (no challenge guard needed)", async () => {
      mockPrisma.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Draft" });

      await callAction({ intent: "hl-force-unmark-ready", domainId: DOMAIN_ID, confirm: "true" });

      expect(mockPrisma.domainApplicationCycle.upsert).toHaveBeenCalledWith({
        where: { domainId_applicationCycleId: { domainId: DOMAIN_ID, applicationCycleId: CYCLE_ID } },
        update: { isReady: false },
        create: { domainId: DOMAIN_ID, applicationCycleId: CYCLE_ID, isReady: false },
      });
      expect(mockPrisma.challengeVersionApplicationCycle.count).not.toHaveBeenCalled();
    });
  });

  describe("set-close-date", () => {
    it("clears originalCloseDate so a manual reset isn't shown as an extension", async () => {
      await callAction({ intent: "set-close-date", closeDate: "2026-06-01" });

      // Close date is anchored to 11:59:59 PM Eastern (June is EDT, UTC-4)
      // → 2026-06-02T03:59:59Z. Asserting the call shape rather than the
      // exact instant keeps the test resilient to any future tz change.
      expect(mockPrisma.applicationCycle.update).toHaveBeenCalledTimes(1);
      const updateArgs = mockPrisma.applicationCycle.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: CYCLE_ID });
      expect(updateArgs.data.originalCloseDate).toBeNull();
      expect(updateArgs.data.closeDate).toBeInstanceOf(Date);
    });

    it("clears originalCloseDate even when the close date is being unset", async () => {
      await callAction({ intent: "set-close-date", closeDate: "" });

      expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
        where: { id: CYCLE_ID },
        data: { closeDate: null, originalCloseDate: null },
      });
    });
  });

  describe("extend-close-date", () => {
    it("captures the pre-extension close date on the first extension", async () => {
      const closeDate = new Date(Date.now() + 86_400_000); // tomorrow
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate,
        originalCloseDate: null,
        statusUpdates: [{ newStatus: "Open" }],
      });

      await callAction({ intent: "extend-close-date", amount: "48", unit: "hours" });

      const expectedClose = new Date(closeDate.getTime() + 48 * 3_600_000);
      expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
        where: { id: CYCLE_ID },
        data: { closeDate: expectedClose, originalCloseDate: closeDate },
      });
      expect(mockPrisma.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
    });

    it("preserves the original anchor on subsequent extensions", async () => {
      const original = new Date(Date.now() + 86_400_000);
      const alreadyExtended = new Date(original.getTime() + 2 * 86_400_000);
      mockPrisma.applicationCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
        closeDate: alreadyExtended,
        originalCloseDate: original,
        statusUpdates: [{ newStatus: "Open" }],
      });

      await callAction({ intent: "extend-close-date", amount: "1", unit: "days" });

      const expectedClose = new Date(alreadyExtended.getTime() + 86_400_000);
      expect(mockPrisma.applicationCycle.update).toHaveBeenCalledWith({
        where: { id: CYCLE_ID },
        data: { closeDate: expectedClose, originalCloseDate: original },
      });
    });

    it("reopens the cycle when extending past now after auto-close", async () => {
      // Cycle that auto-closed yesterday. Lead extends by 48h, pushing
      // closeDate into the future — applications should reopen.
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
});
