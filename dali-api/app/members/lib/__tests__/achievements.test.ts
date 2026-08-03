import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { achievementsForMember } from "~/members/lib/achievements.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const USER = "user-1";

const PAST = new Date("2020-01-01");
const FUTURE = new Date("2999-01-01");

function assignment(termId: string, endDate: Date) {
  return { termId, term: { endDate } };
}

async function earnedKeys(): Promise<string[]> {
  const all = await achievementsForMember(USER);
  return all.filter((a) => a.earned).map((a) => a.key);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Nothing achieved: every source empty.
  mockPrisma.dALIMember!.findUnique.mockResolvedValue({ onboardedAt: null });
  mockPrisma.projectAssignment!.findMany.mockResolvedValue([]);
  mockPrisma.domainEligibility!.findMany.mockResolvedValue([]);
  mockPrisma.educationApplication!.count.mockResolvedValue(0);
  mockPrisma.mentorshipPair!.count.mockResolvedValue(0);
  mockPrisma.timeEntry!.findMany.mockResolvedValue([]);
  mockPrisma.page!.count.mockResolvedValue(0);
  mockPrisma.applicationReview!.findMany.mockResolvedValue([]);
  mockPrisma.interviewAssignment!.findMany.mockResolvedValue([]);
  mockPrisma.decision!.findFirst.mockResolvedValue(null);
});

describe("achievementsForMember", () => {
  it("returns the whole catalog with an earned flag", async () => {
    const all = await achievementsForMember(USER);
    expect(all).toHaveLength(10);
    expect(all.every((a) => !a.earned)).toBe(true);
    expect(new Set(all.map((a) => a.key)).size).toBe(10);
  });

  it("awards nothing to a brand-new member", async () => {
    expect(await earnedKeys()).toEqual([]);
  });
});

describe("onboarding and tenure", () => {
  it("awards onboarding once onboardedAt is set", async () => {
    mockPrisma.dALIMember!.findUnique.mockResolvedValue({ onboardedAt: PAST });
    expect(await earnedKeys()).toContain("onboarded");
  });

  it("does not award a first term while that term is still running", async () => {
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([assignment("t1", FUTURE)]);
    expect(await earnedKeys()).not.toContain("first-term");
  });

  it("awards a first term once the term has ended", async () => {
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([assignment("t1", PAST)]);
    expect(await earnedKeys()).toContain("first-term");
  });

  it("needs more than three distinct terms for the veteran medal", async () => {
    const three = ["t1", "t2", "t3"].map((t) => assignment(t, PAST));
    mockPrisma.projectAssignment!.findMany.mockResolvedValue(three);
    expect(await earnedKeys()).not.toContain("veteran");

    mockPrisma.projectAssignment!.findMany.mockResolvedValue([
      ...three,
      assignment("t4", PAST),
    ]);
    expect(await earnedKeys()).toContain("veteran");
  });
});

describe("domains", () => {
  // The bug this replaced: multi-domain counted ProjectAssignment domains, so
  // someone hired into two domains but staffed in one didn't earn it, while
  // someone hired into one but staffed in two did.
  it("counts domains a member is hired into, not domains they were staffed in", async () => {
    mockPrisma.domainEligibility!.findMany.mockResolvedValue([
      { domainId: "eng", level: "P1" },
      { domainId: "design", level: "P1" },
    ]);
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([assignment("t1", PAST)]);
    expect(await earnedKeys()).toContain("multi-domain");
  });

  it("is not earned on a single eligibility, however many projects", async () => {
    mockPrisma.domainEligibility!.findMany.mockResolvedValue([{ domainId: "eng", level: "P1" }]);
    mockPrisma.projectAssignment!.findMany.mockResolvedValue([
      assignment("t1", PAST),
      assignment("t2", PAST),
    ]);
    expect(await earnedKeys()).not.toContain("multi-domain");
  });

  it("awards promotion for a level past P1", async () => {
    mockPrisma.domainEligibility!.findMany.mockResolvedValue([{ domainId: "eng", level: "P1" }]);
    expect(await earnedKeys()).not.toContain("promoted");

    mockPrisma.domainEligibility!.findMany.mockResolvedValue([{ domainId: "eng", level: "P2" }]);
    expect(await earnedKeys()).toContain("promoted");
  });

  it("counts P3 as promoted too", async () => {
    mockPrisma.domainEligibility!.findMany.mockResolvedValue([{ domainId: "eng", level: "P3" }]);
    expect(await earnedKeys()).toContain("promoted");
  });
});

describe("education and mentorship", () => {
  it("awards the class medal for an approved enrollment", async () => {
    mockPrisma.educationApplication!.count.mockResolvedValue(1);
    expect(await earnedKeys()).toContain("student");
  });

  it("awards mentoring on the first pair", async () => {
    mockPrisma.mentorshipPair!.count.mockResolvedValue(1);
    expect(await earnedKeys()).toContain("mentor");
  });
});

describe("hours in a pay period", () => {
  const day = (iso: string, hours: number) => ({ date: new Date(`${iso}T00:00:00Z`), hours });

  it("is not earned when 40 hours are spread across two pay periods", async () => {
    // 2026-07-18 ends a period; 2026-07-19 starts the next.
    mockPrisma.timeEntry!.findMany.mockResolvedValue([
      day("2026-07-18", 30),
      day("2026-07-19", 30),
    ]);
    expect(await earnedKeys()).not.toContain("big-period");
  });

  it("is earned when one period exceeds 40 hours", async () => {
    mockPrisma.timeEntry!.findMany.mockResolvedValue([
      day("2026-07-06", 21),
      day("2026-07-17", 20.5),
    ]);
    expect(await earnedKeys()).toContain("big-period");
  });

  it("needs more than 40, not exactly 40", async () => {
    mockPrisma.timeEntry!.findMany.mockResolvedValue([day("2026-07-06", 40)]);
    expect(await earnedKeys()).not.toContain("big-period");
  });
});

describe("talent scout", () => {
  it("is earned when someone you reviewed was accepted", async () => {
    mockPrisma.applicationReview!.findMany.mockResolvedValue([{ domainApplicationId: "da1" }]);
    mockPrisma.decision!.findFirst.mockResolvedValue({ id: "d1" });
    expect(await earnedKeys()).toContain("talent-scout");
  });

  it("is earned when someone you interviewed was accepted", async () => {
    mockPrisma.interviewAssignment!.findMany.mockResolvedValue([
      { interview: { domainApplicationId: "da2" } },
    ]);
    mockPrisma.decision!.findFirst.mockResolvedValue({ id: "d1" });
    expect(await earnedKeys()).toContain("talent-scout");
  });

  it("is not earned when nobody you judged got in", async () => {
    mockPrisma.applicationReview!.findMany.mockResolvedValue([{ domainApplicationId: "da1" }]);
    mockPrisma.decision!.findFirst.mockResolvedValue(null);
    expect(await earnedKeys()).not.toContain("talent-scout");
  });

  it("skips the decision query entirely when you judged nobody", async () => {
    expect(await earnedKeys()).not.toContain("talent-scout");
    expect(mockPrisma.decision!.findFirst).not.toHaveBeenCalled();
  });

  it("only counts a Released acceptance", async () => {
    mockPrisma.applicationReview!.findMany.mockResolvedValue([{ domainApplicationId: "da1" }]);
    mockPrisma.decision!.findFirst.mockResolvedValue({ id: "d1" });
    await earnedKeys();
    expect(mockPrisma.decision!.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "Accepted", stage: "Released" }),
      }),
    );
  });
});

describe("personal pages", () => {
  it("needs more than five", async () => {
    mockPrisma.page!.count.mockResolvedValue(5);
    expect(await earnedKeys()).not.toContain("prolific");

    mockPrisma.page!.count.mockResolvedValue(6);
    expect(await earnedKeys()).toContain("prolific");
  });

  it("counts only this member's live pages", async () => {
    mockPrisma.page!.count.mockResolvedValue(6);
    await earnedKeys();
    expect(mockPrisma.page!.count).toHaveBeenCalledWith({
      where: { workspaceType: "Member", workspaceId: USER, archivedAt: null },
    });
  });
});
