import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  currentTermMemberWhere: vi.fn().mockResolvedValue({ active: true }),
}));

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { addDomainMentors, domainMentorIds } from "~/hiring/lib/cycle-rosters.server";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user = { findMany: vi.fn().mockResolvedValue([{ id: "m1" }, { id: "m2" }]) };
  mockPrisma.cycleReviewer = { createMany: vi.fn().mockResolvedValue({ count: 1 }) };
  mockPrisma.cycleInterviewer = { createMany: vi.fn().mockResolvedValue({ count: 2 }) };
});

describe("domainMentorIds", () => {
  it("finds active members at P3 in the domain", async () => {
    expect(await domainMentorIds("d1")).toEqual(["m1", "m2"]);
    expect(mockPrisma.user.findMany.mock.calls[0][0].where).toEqual({
      active: true,
      domainEligibilities: { some: { domainId: "d1", level: "P3" } },
    });
  });
});

describe("addDomainMentors audit", () => {
  const request = new Request("http://localhost/hiring");

  it("logs the roster add once, with the actor, role and how many were new", async () => {
    await addDomainMentors("c1", "d1", "interviewer", request, "iv2", "lead-1");

    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "domain.mentors.add",
      userId: "lead-1",
      targetId: "d1",
      metadata: { cycleId: "c1", role: "interviewer", added: 2 },
      request,
    });
  });

  it("logs nothing when nobody was added", async () => {
    mockPrisma.cycleReviewer.createMany.mockResolvedValue({ count: 0 });
    await addDomainMentors("c1", "d1", "reviewer", request, undefined, "lead-1");
    mockPrisma.user.findMany.mockResolvedValue([]);
    await addDomainMentors("c1", "d1", "reviewer", request, undefined, "lead-1");
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("addDomainMentors", () => {
  it("adds them as reviewers for that domain, skipping anyone already there", async () => {
    expect(await addDomainMentors("c1", "d1", "reviewer")).toBe(1);
    expect(mockPrisma.cycleReviewer.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "m1", applicationCycleId: "c1", domainId: "d1" },
        { userId: "m2", applicationCycleId: "c1", domainId: "d1" },
      ],
      skipDuplicates: true,
    });
    expect(mockPrisma.cycleInterviewer.createMany).not.toHaveBeenCalled();
  });

  it("adds them as interviewers when asked", async () => {
    expect(await addDomainMentors("c1", "d1", "interviewer")).toBe(2);
    expect(mockPrisma.cycleReviewer.createMany).not.toHaveBeenCalled();
  });

  it("adds interviewers to the first round unless another is named", async () => {
    await addDomainMentors("c1", "d1", "interviewer");
    await addDomainMentors("c1", "d1", "interviewer", undefined, "iv2");
    const rounds = mockPrisma.cycleInterviewer.createMany.mock.calls.map((c: any[]) =>
      [...new Set(c[0].data.map((d: any) => d.interviewRoundId))],
    );
    expect(rounds).toEqual([["interviews"], ["iv2"]]);
  });

  it("does nothing when the domain has no mentors", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    expect(await addDomainMentors("c1", "d1", "reviewer")).toBe(0);
    expect(mockPrisma.cycleReviewer.createMany).not.toHaveBeenCalled();
  });
});
