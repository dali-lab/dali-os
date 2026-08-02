import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { achievementsForMember } from "~/members/lib/achievements.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const USER = "user-1";

const PAST = new Date("2020-01-01");
const FUTURE = new Date("2999-01-01");

function assignment(domainId: string, termId: string, endDate: Date) {
  return { domainId, termId, term: { endDate } };
}

async function earnedKeys(): Promise<string[]> {
  const all = await achievementsForMember(USER);
  return all.filter((a) => a.earned).map((a) => a.key);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.dALIMember.findUnique.mockResolvedValue({ onboardedAt: null });
  mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
});

describe("achievementsForMember", () => {
  it("returns the whole catalog so the profile can show what's still locked", async () => {
    const all = await achievementsForMember(USER);
    expect(all).toHaveLength(4);
    expect(all.every((a) => !a.earned)).toBe(true);
  });

  it("awards nothing to a brand-new member", async () => {
    expect(await earnedKeys()).toEqual([]);
  });

  it("awards onboarding once onboardedAt is set", async () => {
    mockPrisma.dALIMember.findUnique.mockResolvedValue({ onboardedAt: PAST });
    expect(await earnedKeys()).toEqual(["onboarded"]);
  });

  it("does not award a first term while that term is still running", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      assignment("design", "term-1", FUTURE),
    ]);
    expect(await earnedKeys()).not.toContain("first-term");
  });

  it("awards a first term once the term has ended", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      assignment("design", "term-1", PAST),
    ]);
    expect(await earnedKeys()).toContain("first-term");
  });

  it("does not award multi-domain for repeat terms in one domain", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      assignment("design", "term-1", PAST),
      assignment("design", "term-2", PAST),
    ]);
    expect(await earnedKeys()).not.toContain("multi-domain");
  });

  it("awards multi-domain across two domains", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      assignment("design", "term-1", PAST),
      assignment("dev", "term-1", PAST),
    ]);
    expect(await earnedKeys()).toContain("multi-domain");
  });

  it("needs more than three distinct terms for the veteran medal", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      assignment("design", "term-1", PAST),
      assignment("design", "term-2", PAST),
      assignment("design", "term-3", PAST),
    ]);
    expect(await earnedKeys()).not.toContain("veteran");

    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      assignment("design", "term-1", PAST),
      assignment("design", "term-2", PAST),
      assignment("design", "term-3", PAST),
      assignment("design", "term-4", PAST),
    ]);
    expect(await earnedKeys()).toContain("veteran");
  });

  it("counts terms, not assignments — two projects in one term is still one term", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      assignment("design", "term-1", PAST),
      assignment("dev", "term-1", PAST),
      assignment("design", "term-2", PAST),
      assignment("dev", "term-2", PAST),
    ]);
    expect(await earnedKeys()).not.toContain("veteran");
  });
});
