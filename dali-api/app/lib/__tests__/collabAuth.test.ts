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
    instructorAssignment: { findFirst: vi.fn() },
    educationOffering: { findUnique: vi.fn() },
    educationApplication: { findFirst: vi.fn() },
    educationSubmission: { findUnique: vi.fn() },
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

// The doc: branch now delegates to getPageAccess. Mock it so collabAuth tests
// stay focused on the entity-routing logic rather than re-testing page access
// rules (those live in pageAccess.server.test.ts).
vi.mock("~/lib/pageAccess.server", () => ({
  getPageAccess: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isDomainLead, isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { getPageAccess } from "~/lib/pageAccess.server";
import { authorizeCollabDoc } from "../collabAuth";

const mockPrisma = prisma as any;

// Helper: expect allowed=true, readOnly=false
function allowed() {
  return { allowed: true, readOnly: false };
}
// Helper: expect denied (readOnly value doesn't matter when denied)
function denied() {
  return expect.objectContaining({ allowed: false });
}

beforeEach(() => {
  vi.resetAllMocks();
  (isDomainLead as any).mockResolvedValue(false);
  (isCore as any).mockResolvedValue(false);
  (isProjectMember as any).mockResolvedValue(false);
  (isLabMember as any).mockResolvedValue(false);
  (partnerHasProjectAccess as any).mockResolvedValue(false);
  (getCycleConfidentialityState as any).mockResolvedValue({ status: "signed", activeVersionId: "v1" });
  (prisma as any).interview.findUnique.mockResolvedValue({ applicationCycleId: "cycle1" });
  vi.mocked(getPageAccess).mockResolvedValue({
    canView: false,
    canEdit: false,
    canComment: false,
    canResolve: false,
  });
});

describe("authorizeCollabDoc", () => {
  it("rejects malformed names", async () => {
    expect(await authorizeCollabDoc("user1", "bad")).toMatchObject(denied());
    expect(await authorizeCollabDoc("user1", "a:b:c:d")).toMatchObject(denied());
    expect(await authorizeCollabDoc("user1", "")).toMatchObject(denied());
  });

  it("rejects unknown entity types", async () => {
    expect(await authorizeCollabDoc("user1", "unknown:id:field")).toMatchObject(denied());
  });

  describe("review docs", () => {
    it("allows the reviewer who owns the review", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue({
        id: "r1",
        cycleReviewer: { userId: "user1" },
      });
      expect(await authorizeCollabDoc("user1", "review:r1:feedback")).toEqual(allowed());
    });

    it("rejects non-owner non-lead", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue({
        id: "r1",
        cycleReviewer: { userId: "other-user" },
      });
      expect(await authorizeCollabDoc("user1", "review:r1:feedback")).toMatchObject(denied());
    });

    it("allows domain leads", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue({
        id: "r1",
        cycleReviewer: { userId: "other-user" },
      });
      (isDomainLead as any).mockResolvedValue(true);
      expect(await authorizeCollabDoc("user1", "review:r1:feedback")).toEqual(allowed());
    });

    it("allows hiring leads", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue({
        id: "r1",
        cycleReviewer: { userId: "other-user" },
      });
      (isCore as any).mockResolvedValue(true);
      expect(await authorizeCollabDoc("user1", "review:r1:feedback")).toEqual(allowed());
    });

    it("rejects when review not found", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "review:missing:feedback")).toMatchObject(denied());
    });
  });

  describe("interview docs", () => {
    it("allows assigned interviewer", async () => {
      mockPrisma.interviewAssignment.findFirst.mockResolvedValue({ id: "a1" });
      expect(await authorizeCollabDoc("user1", "interview:int1:notes")).toEqual(allowed());
    });

    it("rejects unassigned non-lead", async () => {
      mockPrisma.interviewAssignment.findFirst.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "interview:int1:notes")).toMatchObject(denied());
    });

    it("allows hiring leads even when not assigned", async () => {
      mockPrisma.interviewAssignment.findFirst.mockResolvedValue(null);
      (isCore as any).mockResolvedValue(true);
      expect(await authorizeCollabDoc("user1", "interview:int1:notes")).toEqual(allowed());
    });
  });

  describe("domainApplication prep-note docs", () => {
    const found = { application: { applicationCycleId: "cycle1" } };

    it("rejects when the domain application is not found", async () => {
      mockPrisma.domainApplication.findUnique.mockResolvedValue(null);
      expect(
        await authorizeCollabDoc("user1", "domainApplication:da1:prepNote"),
      ).toMatchObject(denied());
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
      ).toMatchObject(denied());
    });

    it("rejects a signed non-lead", async () => {
      mockPrisma.domainApplication.findUnique.mockResolvedValue(found);
      expect(
        await authorizeCollabDoc("user1", "domainApplication:da1:prepNote"),
      ).toMatchObject(denied());
    });

    it("allows a signed domain lead", async () => {
      mockPrisma.domainApplication.findUnique.mockResolvedValue(found);
      (isDomainLead as any).mockResolvedValue(true);
      expect(
        await authorizeCollabDoc("user1", "domainApplication:da1:prepNote"),
      ).toEqual(allowed());
    });

    it("allows a signed hiring lead", async () => {
      mockPrisma.domainApplication.findUnique.mockResolvedValue(found);
      (isCore as any).mockResolvedValue(true);
      expect(
        await authorizeCollabDoc("user1", "domainApplication:da1:prepNote"),
      ).toEqual(allowed());
    });
  });

  describe("page docs (doc:{pageId}:body)", () => {
    function setPage(overrides: Record<string, unknown> = {}) {
      mockPrisma.page.findUnique.mockResolvedValue({
        archivedAt: null,
        workspaceType: "Project",
        workspaceId: "proj1",
        partnerVisible: false,
        createdById: null,
        ...overrides,
      });
    }

    it("rejects when the page is missing or archived", async () => {
      mockPrisma.page.findUnique.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toMatchObject(denied());

      setPage({ archivedAt: new Date() });
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toMatchObject(denied());
    });

    it("returns allowed=true, readOnly=false when canView and canEdit", async () => {
      setPage();
      vi.mocked(getPageAccess).mockResolvedValue({
        canView: true,
        canEdit: true,
        canComment: true,
        canResolve: true,
      });
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toEqual({
        allowed: true,
        readOnly: false,
      });
    });

    it("returns allowed=true, readOnly=true when canView but not canEdit (viewer-only)", async () => {
      setPage({ partnerVisible: true });
      vi.mocked(getPageAccess).mockResolvedValue({
        canView: true,
        canEdit: false,
        canComment: true,
        canResolve: false,
      });
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toEqual({
        allowed: true,
        readOnly: true,
      });
    });

    it("rejects when getPageAccess denies (canView=false)", async () => {
      setPage();
      vi.mocked(getPageAccess).mockResolvedValue({
        canView: false,
        canEdit: false,
        canComment: false,
        canResolve: false,
      });
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toMatchObject(denied());
    });
  });

  describe("partner SOW docs (partnersow:{applicationId}:body)", () => {
    it("rejects when the application is missing", async () => {
      mockPrisma.partnerApplication.findUnique.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "partnersow:app1:body")).toMatchObject(denied());
    });

    it("allows Core", async () => {
      mockPrisma.partnerApplication.findUnique.mockResolvedValue({ partnerOrgId: "org1" });
      (isCore as any).mockResolvedValue(true);
      expect(await authorizeCollabDoc("user1", "partnersow:app1:body")).toEqual(allowed());
    });

    it("allows a partner in the owning org", async () => {
      mockPrisma.partnerApplication.findUnique.mockResolvedValue({ partnerOrgId: "org1" });
      mockPrisma.partnerUser.findUnique.mockResolvedValue({ partnerOrgId: "org1" });
      expect(await authorizeCollabDoc("user1", "partnersow:app1:body")).toEqual(allowed());
    });

    it("rejects a partner from another org", async () => {
      mockPrisma.partnerApplication.findUnique.mockResolvedValue({ partnerOrgId: "org1" });
      mockPrisma.partnerUser.findUnique.mockResolvedValue({ partnerOrgId: "org2" });
      expect(await authorizeCollabDoc("user1", "partnersow:app1:body")).toMatchObject(denied());
    });

    it("rejects non-partner non-Core users", async () => {
      mockPrisma.partnerApplication.findUnique.mockResolvedValue({ partnerOrgId: "org1" });
      mockPrisma.partnerUser.findUnique.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "partnersow:app1:body")).toMatchObject(denied());
    });
  });

  describe("education offering pages (doc:{pageId}:body, EducationOffering)", () => {
    const eduPage = (over: Record<string, unknown> = {}) => ({
      archivedAt: null,
      workspaceType: "EducationOffering",
      workspaceId: "off1",
      partnerVisible: false,
      studentEditable: false,
      ...over,
    });

    it("allows an assigned instructor", async () => {
      mockPrisma.page.findUnique.mockResolvedValue(eduPage());
      // getPageAccess owns the instructor gate post-merge.
      vi.mocked(getPageAccess).mockResolvedValue({
        canView: true,
        canEdit: true,
        canComment: true,
        canResolve: true,
      });
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toMatchObject(allowed());
    });

    it("rejects a student on a non-collaborative material page", async () => {
      mockPrisma.page.findUnique.mockResolvedValue(eduPage());
      mockPrisma.educationApplication.findFirst.mockResolvedValue({ id: "app1" });
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toMatchObject(denied());
      // Never even checks enrollment — the page isn't studentEditable.
      expect(mockPrisma.educationApplication.findFirst).not.toHaveBeenCalled();
    });

    it("allows an enrolled student on a studentEditable page of a live offering", async () => {
      mockPrisma.page.findUnique.mockResolvedValue(eduPage({ studentEditable: true }));
      mockPrisma.educationOffering.findUnique.mockResolvedValue({
        status: "Published",
        closedOutAt: null,
      });
      mockPrisma.educationApplication.findFirst.mockResolvedValue({ id: "app1" });
      // Enrolled students get a writable room even though getPageAccess denies
      // them — that carve-out lives in collabAuth.
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toMatchObject(allowed());
    });

    it("rejects a non-enrolled user on a studentEditable page", async () => {
      mockPrisma.page.findUnique.mockResolvedValue(eduPage({ studentEditable: true }));
      mockPrisma.educationOffering.findUnique.mockResolvedValue({
        status: "Published",
        closedOutAt: null,
      });
      mockPrisma.educationApplication.findFirst.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toMatchObject(denied());
    });

    it("rejects an enrolled student once the offering is closed out", async () => {
      mockPrisma.page.findUnique.mockResolvedValue(eduPage({ studentEditable: true }));
      mockPrisma.educationOffering.findUnique.mockResolvedValue({
        status: "Published",
        closedOutAt: new Date(),
      });
      mockPrisma.educationApplication.findFirst.mockResolvedValue({ id: "app1" });
      expect(await authorizeCollabDoc("user1", "doc:p1:body")).toMatchObject(denied());
    });
  });

  describe("education submission docs (edusubmission:{id}:content|feedback)", () => {
    const submission = (studentId: string) => ({
      studentId,
      assignment: { offeringId: "off1", session: null },
    });

    it("allows the owning student on their content doc", async () => {
      mockPrisma.educationSubmission.findUnique.mockResolvedValue(submission("user1"));
      mockPrisma.instructorAssignment.findFirst.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "edusubmission:s1:content")).toMatchObject(allowed());
    });

    it("rejects a different student on someone else's content doc", async () => {
      mockPrisma.educationSubmission.findUnique.mockResolvedValue(submission("other"));
      mockPrisma.instructorAssignment.findFirst.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "edusubmission:s1:content")).toMatchObject(denied());
    });

    it("denies the student on the feedback doc but allows the instructor", async () => {
      mockPrisma.educationSubmission.findUnique.mockResolvedValue(submission("user1"));
      mockPrisma.instructorAssignment.findFirst.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "edusubmission:s1:feedback")).toMatchObject(denied());

      mockPrisma.instructorAssignment.findFirst.mockResolvedValue({ id: "ia1" });
      expect(await authorizeCollabDoc("instr1", "edusubmission:s1:feedback")).toMatchObject(allowed());
    });
  });

  describe("epic description docs", () => {
    it("rejects when no epic has that descriptionDocId", async () => {
      mockPrisma.epic.findFirst.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "epic:abc:description")).toMatchObject(denied());
    });

    it("rejects non-leads even when the epic exists", async () => {
      mockPrisma.epic.findFirst.mockResolvedValue({ id: "e1" });
      expect(await authorizeCollabDoc("user1", "epic:abc:description")).toMatchObject(denied());
    });

    it("allows hiring leads when the epic exists", async () => {
      mockPrisma.epic.findFirst.mockResolvedValue({ id: "e1" });
      (isCore as any).mockResolvedValue(true);
      expect(await authorizeCollabDoc("user1", "epic:abc:description")).toEqual(allowed());
    });
  });
});
