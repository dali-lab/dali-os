import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    applicationReview: { findUnique: vi.fn() },
    interviewAssignment: { findFirst: vi.fn() },
    interview: { findUnique: vi.fn() },
    domainApplication: { findUnique: vi.fn() },
    epic: { findFirst: vi.fn() },
    page: { findUnique: vi.fn() },
    partnerApplication: { findUnique: vi.fn() },
    partnerUser: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/roles", () => ({
  isDomainLead: vi.fn().mockResolvedValue(false),
  isCore: vi.fn().mockResolvedValue(false),
  isProjectMember: vi.fn().mockResolvedValue(false),
  isLabMember: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/partners/lib/partner-access", () => ({
  partnerHasProjectAccess: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/hiring/lib/confidentiality", () => ({
  getCycleConfidentialityState: vi.fn().mockResolvedValue({ status: "signed", activeVersionId: "v1" }),
}));

import { prisma } from "~/lib/db";
import { isDomainLead, isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { authorizeCollabDoc } from "../collabAuth";

const mockPrisma = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  (isDomainLead as any).mockResolvedValue(false);
  (isCore as any).mockResolvedValue(false);
  (isProjectMember as any).mockResolvedValue(false);
  (isLabMember as any).mockResolvedValue(false);
  (partnerHasProjectAccess as any).mockResolvedValue(false);
  (getCycleConfidentialityState as any).mockResolvedValue({ status: "signed", activeVersionId: "v1" });
  (prisma as any).interview.findUnique.mockResolvedValue({ applicationCycleId: "cycle1" });
});

describe("authorizeCollabDoc", () => {
  it("rejects malformed names", async () => {
    expect(await authorizeCollabDoc("user1", "bad")).toBe(false);
    expect(await authorizeCollabDoc("user1", "a:b:c:d")).toBe(false);
    expect(await authorizeCollabDoc("user1", "")).toBe(false);
  });

  it("rejects unknown entity types", async () => {
    expect(await authorizeCollabDoc("user1", "unknown:id:field")).toBe(false);
  });

  describe("review docs", () => {
    it("allows the reviewer who owns the review", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue({
        id: "r1",
        cycleReviewer: { userId: "user1" },
      });

      expect(await authorizeCollabDoc("user1", "review:r1:feedback")).toBe(true);
    });

    it("rejects non-owner non-lead", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue({
        id: "r1",
        cycleReviewer: { userId: "other-user" },
      });

      expect(await authorizeCollabDoc("user1", "review:r1:feedback")).toBe(false);
    });

    it("allows domain leads", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue({
        id: "r1",
        cycleReviewer: { userId: "other-user" },
      });
      (isDomainLead as any).mockResolvedValue(true);

      expect(await authorizeCollabDoc("user1", "review:r1:feedback")).toBe(true);
    });

    it("allows hiring leads", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue({
        id: "r1",
        cycleReviewer: { userId: "other-user" },
      });
      (isCore as any).mockResolvedValue(true);

      expect(await authorizeCollabDoc("user1", "review:r1:feedback")).toBe(true);
    });

    it("rejects when review not found", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "review:missing:feedback")).toBe(false);
    });
  });

  describe("interview docs", () => {
    it("allows assigned interviewer", async () => {
      mockPrisma.interviewAssignment.findFirst.mockResolvedValue({ id: "a1" });

      expect(await authorizeCollabDoc("user1", "interview:int1:notes")).toBe(true);
    });

    it("rejects unassigned non-lead", async () => {
      mockPrisma.interviewAssignment.findFirst.mockResolvedValue(null);

      expect(await authorizeCollabDoc("user1", "interview:int1:notes")).toBe(false);
    });

    it("allows hiring leads even when not assigned", async () => {
      mockPrisma.interviewAssignment.findFirst.mockResolvedValue(null);
      (isCore as any).mockResolvedValue(true);

      expect(await authorizeCollabDoc("user1", "interview:int1:notes")).toBe(true);
    });
  });

  describe("domainApplication prep-note docs", () => {
    const found = { application: { applicationCycleId: "cycle1" } };

    it("rejects when the domain application is not found", async () => {
      mockPrisma.domainApplication.findUnique.mockResolvedValue(null);
      expect(
        await authorizeCollabDoc("user1", "domainApplication:da1:prepNote"),
      ).toBe(false);
    });

    it("rejects when confidentiality is not signed", async () => {
      mockPrisma.domainApplication.findUnique.mockResolvedValue(found);
      (getCycleConfidentialityState as any).mockResolvedValue({
        status: "unsigned",
        activeVersionId: "v1",
      });
      (isCore as any).mockResolvedValue(true);
      expect(
        await authorizeCollabDoc("user1", "domainApplication:da1:prepNote"),
      ).toBe(false);
    });

    it("rejects a signed non-lead", async () => {
      mockPrisma.domainApplication.findUnique.mockResolvedValue(found);
      expect(
        await authorizeCollabDoc("user1", "domainApplication:da1:prepNote"),
      ).toBe(false);
    });

    it("allows a signed domain lead", async () => {
      mockPrisma.domainApplication.findUnique.mockResolvedValue(found);
      (isDomainLead as any).mockResolvedValue(true);
      expect(
        await authorizeCollabDoc("user1", "domainApplication:da1:prepNote"),
      ).toBe(true);
    });

    it("allows a signed hiring lead", async () => {
      mockPrisma.domainApplication.findUnique.mockResolvedValue(found);
      (isCore as any).mockResolvedValue(true);
      expect(
        await authorizeCollabDoc("user1", "domainApplication:da1:prepNote"),
      ).toBe(true);
    });
  });

  describe("page docs (doc:{pageId}:body)", () => {
    const projectPage = (over: Record<string, unknown> = {}) => ({
      archivedAt: null,
      workspaceType: "Project",
      workspaceId: "proj1",
      partnerVisible: false,
      ...over,
    });

    it("rejects when the page is missing or archived", async () => {
      mockPrisma.page.findUnique.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toBe(false);

      mockPrisma.page.findUnique.mockResolvedValue(
        projectPage({ archivedAt: new Date() }),
      );
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toBe(false);
    });

    it("allows Core on any workspace", async () => {
      (isCore as any).mockResolvedValue(true);
      mockPrisma.page.findUnique.mockResolvedValue(
        projectPage({ workspaceType: "Lab", workspaceId: null }),
      );
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toBe(true);
    });

    it("allows a lab member on Lab pages", async () => {
      (isLabMember as any).mockResolvedValue(true);
      mockPrisma.page.findUnique.mockResolvedValue(
        projectPage({ workspaceType: "Lab", workspaceId: null }),
      );
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toBe(true);
      expect(isLabMember).toHaveBeenCalledWith("user1");
    });

    it("rejects a non-member on Lab pages", async () => {
      mockPrisma.page.findUnique.mockResolvedValue(
        projectPage({ workspaceType: "Lab", workspaceId: null }),
      );
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toBe(false);
    });

    it("allows a staffed project member on project pages", async () => {
      mockPrisma.page.findUnique.mockResolvedValue(projectPage());
      (isProjectMember as any).mockResolvedValue(true);
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toBe(true);
      expect(isProjectMember).toHaveBeenCalledWith("user1", "proj1");
    });

    it("rejects partners on unshared project pages", async () => {
      mockPrisma.page.findUnique.mockResolvedValue(projectPage());
      (partnerHasProjectAccess as any).mockResolvedValue(true);
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toBe(false);
      expect(partnerHasProjectAccess).not.toHaveBeenCalled();
    });

    it("allows partners with project access on shared pages", async () => {
      mockPrisma.page.findUnique.mockResolvedValue(
        projectPage({ partnerVisible: true }),
      );
      (partnerHasProjectAccess as any).mockResolvedValue(true);
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toBe(true);
      expect(partnerHasProjectAccess).toHaveBeenCalledWith("user1", "proj1");
    });

    it("rejects partners without project access even on shared pages", async () => {
      mockPrisma.page.findUnique.mockResolvedValue(
        projectPage({ partnerVisible: true }),
      );
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toBe(false);
    });
  });

  describe("partner SOW docs (partnersow:{applicationId}:body)", () => {
    it("rejects when the application is missing", async () => {
      mockPrisma.partnerApplication.findUnique.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "partnersow:app1:body")).toBe(false);
    });

    it("allows Core", async () => {
      mockPrisma.partnerApplication.findUnique.mockResolvedValue({
        partnerOrgId: "org1",
      });
      (isCore as any).mockResolvedValue(true);
      expect(await authorizeCollabDoc("user1", "partnersow:app1:body")).toBe(true);
    });

    it("allows a partner in the owning org", async () => {
      mockPrisma.partnerApplication.findUnique.mockResolvedValue({
        partnerOrgId: "org1",
      });
      mockPrisma.partnerUser.findUnique.mockResolvedValue({ partnerOrgId: "org1" });
      expect(await authorizeCollabDoc("user1", "partnersow:app1:body")).toBe(true);
    });

    it("rejects a partner from another org", async () => {
      mockPrisma.partnerApplication.findUnique.mockResolvedValue({
        partnerOrgId: "org1",
      });
      mockPrisma.partnerUser.findUnique.mockResolvedValue({ partnerOrgId: "org2" });
      expect(await authorizeCollabDoc("user1", "partnersow:app1:body")).toBe(false);
    });

    it("rejects non-partner non-Core users", async () => {
      mockPrisma.partnerApplication.findUnique.mockResolvedValue({
        partnerOrgId: "org1",
      });
      mockPrisma.partnerUser.findUnique.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "partnersow:app1:body")).toBe(false);
    });
  });

  describe("epic description docs", () => {
    it("rejects when no epic has that descriptionDocId", async () => {
      mockPrisma.epic.findFirst.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "epic:abc:description")).toBe(false);
    });

    it("rejects non-leads even when the epic exists", async () => {
      mockPrisma.epic.findFirst.mockResolvedValue({ id: "e1" });
      expect(await authorizeCollabDoc("user1", "epic:abc:description")).toBe(false);
    });

    it("allows hiring leads when the epic exists", async () => {
      mockPrisma.epic.findFirst.mockResolvedValue({ id: "e1" });
      (isCore as any).mockResolvedValue(true);
      expect(await authorizeCollabDoc("user1", "epic:abc:description")).toBe(true);
    });
  });
});
