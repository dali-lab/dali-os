import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db";
import { isInternToFullEligible } from "~/hiring/lib/intern-eligibility";

vi.mock("~/lib/db", () => ({
  prisma: {
    term: { findFirst: vi.fn() },
    projectAssignment: { findFirst: vi.fn() },
  },
}));

const mockPrisma = prisma as unknown as {
  term: { findFirst: ReturnType<typeof vi.fn> };
  projectAssignment: { findFirst: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isInternToFullEligible", () => {
  it("returns false when no term is active right now (fails closed between terms)", async () => {
    mockPrisma.term.findFirst.mockResolvedValue(null);
    await expect(isInternToFullEligible("user-1")).resolves.toBe(false);
    expect(mockPrisma.projectAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("returns false when the user has no intern-program ProjectAssignment in the active term", async () => {
    mockPrisma.term.findFirst.mockResolvedValue({ id: "term-1" });
    mockPrisma.projectAssignment.findFirst.mockResolvedValue(null);
    await expect(isInternToFullEligible("user-1")).resolves.toBe(false);
    const args = mockPrisma.projectAssignment.findFirst.mock.calls[0][0];
    expect(args.where.userId).toBe("user-1");
    expect(args.where.termId).toBe("term-1");
    expect(args.where.domain).toEqual({ isInternProgram: true });
  });

  it("returns true when the user has an active intern-program assignment", async () => {
    mockPrisma.term.findFirst.mockResolvedValue({ id: "term-1" });
    mockPrisma.projectAssignment.findFirst.mockResolvedValue({ id: "pa-1" });
    await expect(isInternToFullEligible("user-1")).resolves.toBe(true);
  });
});
