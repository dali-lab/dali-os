import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/hiring/lib/core-hiring.server", () => ({
  getCoreDomain: vi.fn().mockResolvedValue({ id: "core" }),
  defaultCoreReviewerIds: vi.fn().mockResolvedValue(["senior-1"]),
  isCoreCycleEligible: vi.fn(),
  coreOnAccept: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { changeApplicants } from "~/hiring/lib/cycle-applicants.server";
import { defaultTimeline } from "~/hiring/lib/cycle-timeline";

const mockPrisma = prisma as unknown as Record<string, any>;

function cycle(applicants: string, status = "Draft") {
  mockPrisma.applicationCycle.findUniqueOrThrow.mockResolvedValue({
    applicants,
    statusUpdates: [{ newStatus: status }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const model = () => ({ deleteMany: vi.fn(), createMany: vi.fn(), upsert: vi.fn() });
  mockPrisma.applicationCycle = { findUniqueOrThrow: vi.fn(), update: vi.fn() };
  mockPrisma.cycleReviewer = model();
  mockPrisma.cycleInterviewer = model();
  mockPrisma.domainApplicationCycle = model();
  mockPrisma.$transaction = vi.fn(async (fn: any) => fn(mockPrisma));
});

describe("changeApplicants", () => {
  it("only changes a Draft cycle", async () => {
    cycle("Students", "Open");
    expect(await changeApplicants("c1", "Interns", true)).toBe("not-draft");
    expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
  });

  it("needs an Admin to move into or out of Lab members", async () => {
    cycle("Students");
    expect(await changeApplicants("c1", "LabMembers", false)).toBe("admin-only");
    cycle("LabMembers");
    expect(await changeApplicants("c1", "Students", false)).toBe("admin-only");
  });

  it("switches Students to Interns with the new group's stages and keeps the domains", async () => {
    cycle("Students");
    expect(await changeApplicants("c1", "Interns", false)).toBeNull();
    expect(mockPrisma.applicationCycle.update.mock.calls[0][0].data).toEqual({
      applicants: "Interns",
      hasChallenges: false,
      hasInterviews: false,
      anonymizeReview: false,
      // Interns: one round straight from review, no interviews.
      timeline: defaultTimeline({ firstDelib: false, interviews: false }),
    });
    expect(mockPrisma.domainApplicationCycle.deleteMany).not.toHaveBeenCalled();
  });

  it("into Lab members: drops the real domains and their people, then links CORE with seeded reviewers", async () => {
    cycle("Students");
    await changeApplicants("c1", "LabMembers", true);
    const where = { applicationCycleId: "c1", domainId: { not: "core" } };
    expect(mockPrisma.domainApplicationCycle.deleteMany).toHaveBeenCalledWith({ where });
    expect(mockPrisma.cycleReviewer.deleteMany).toHaveBeenCalledWith({ where });
    expect(mockPrisma.cycleInterviewer.deleteMany).toHaveBeenCalledWith({ where });
    expect(mockPrisma.domainApplicationCycle.upsert).toHaveBeenCalled();
    expect(mockPrisma.cycleReviewer.createMany.mock.calls[0][0].data).toEqual([
      { userId: "senior-1", applicationCycleId: "c1", domainId: "core" },
    ]);
  });

  it("out of Lab members: drops CORE and its reviewers", async () => {
    cycle("LabMembers");
    await changeApplicants("c1", "Students", true);
    const where = { applicationCycleId: "c1", domainId: "core" };
    expect(mockPrisma.domainApplicationCycle.deleteMany).toHaveBeenCalledWith({ where });
    expect(mockPrisma.cycleReviewer.deleteMany).toHaveBeenCalledWith({ where });
    expect(mockPrisma.domainApplicationCycle.upsert).not.toHaveBeenCalled();
  });
});
