import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth");
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { action } from "~/routes/admin.cycle.$id";

const HIRING_LEAD_ID = "hiring-lead-1";
const CYCLE_ID = "cycle-1";
const DOMAIN_ID = "domain-1";
const CV_ID = "cv-1";
const RV_ID = "rv-1";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user = { findUnique: vi.fn().mockResolvedValue({ id: HIRING_LEAD_ID }) };
  mockPrisma.applicationCycleStatusUpdate = { findFirst: vi.fn() };
  mockPrisma.challengeVersion = { findUnique: vi.fn() };
  mockPrisma.challengeVersionApplicationCycle = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn(),
  };
  mockPrisma.domainApplication = { count: vi.fn().mockResolvedValue(0) };
  mockPrisma.rubricVersion = { findUnique: vi.fn() };
  mockPrisma.applicationReview = { count: vi.fn() };
  mockPrisma.domainApplicationCycle = { upsert: vi.fn().mockResolvedValue({}) };

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
});
