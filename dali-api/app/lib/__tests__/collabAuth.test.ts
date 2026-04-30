import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    applicationReview: { findUnique: vi.fn() },
    dALIMember: { findFirst: vi.fn() },
    interviewAssignment: { findFirst: vi.fn() },
    interview: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/roles", () => ({
  isDomainLead: vi.fn().mockResolvedValue(false),
  isHiringLead: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/confidentiality", () => ({
  getCycleConfidentialityState: vi.fn().mockResolvedValue({ status: "signed", activeVersionId: "v1" }),
}));

import { prisma } from "~/lib/db";
import { isDomainLead, isHiringLead } from "~/lib/roles";
import { getCycleConfidentialityState } from "~/lib/confidentiality";
import { authorizeCollabDoc, hydrateAuthors } from "../collabAuth";

const mockPrisma = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  // Restore defaults
  (isDomainLead as any).mockResolvedValue(false);
  (isHiringLead as any).mockResolvedValue(false);
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
        cycleReviewer: { daliMemberId: "member1" },
      });
      mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: "member1" });

      expect(await authorizeCollabDoc("user1", "review:r1:feedback")).toBe(true);
    });

    it("rejects non-owner non-lead", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue({
        id: "r1",
        cycleReviewer: { daliMemberId: "other-member" },
      });
      mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: "member1" });

      expect(await authorizeCollabDoc("user1", "review:r1:feedback")).toBe(false);
    });

    it("allows domain leads", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue({
        id: "r1",
        cycleReviewer: { daliMemberId: "other-member" },
      });
      mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: "member1" });
      (isDomainLead as any).mockResolvedValue(true);

      expect(await authorizeCollabDoc("user1", "review:r1:feedback")).toBe(true);
    });

    it("allows hiring leads", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue({
        id: "r1",
        cycleReviewer: { daliMemberId: "other-member" },
      });
      mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: "member1" });
      (isHiringLead as any).mockResolvedValue(true);

      expect(await authorizeCollabDoc("user1", "review:r1:feedback")).toBe(true);
    });

    it("rejects when review not found", async () => {
      mockPrisma.applicationReview.findUnique.mockResolvedValue(null);
      expect(await authorizeCollabDoc("user1", "review:missing:feedback")).toBe(false);
    });
  });

  describe("interview docs", () => {
    it("allows assigned interviewer", async () => {
      mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: "member1" });
      mockPrisma.interviewAssignment.findFirst.mockResolvedValue({ id: "a1" });

      expect(await authorizeCollabDoc("user1", "interview:int1:notes")).toBe(true);
    });

    it("rejects unassigned non-lead", async () => {
      mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: "member1" });
      mockPrisma.interviewAssignment.findFirst.mockResolvedValue(null);

      expect(await authorizeCollabDoc("user1", "interview:int1:notes")).toBe(false);
    });

    it("allows hiring leads even when not assigned", async () => {
      mockPrisma.dALIMember.findFirst.mockResolvedValue({ id: "member1" });
      mockPrisma.interviewAssignment.findFirst.mockResolvedValue(null);
      (isHiringLead as any).mockResolvedValue(true);

      expect(await authorizeCollabDoc("user1", "interview:int1:notes")).toBe(true);
    });
  });
});

describe("hydrateAuthors", () => {
  it("returns empty array for empty input", async () => {
    expect(await hydrateAuthors([])).toEqual([]);
  });
});
