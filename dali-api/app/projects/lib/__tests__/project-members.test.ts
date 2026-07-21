import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    projectAssignment: { findMany: vi.fn() },
    externalMentor: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn() }));

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { currentProjectParticipantIds } from "~/projects/lib/project-members.server";

const mockPrisma = prisma as unknown as {
  projectAssignment: { findMany: ReturnType<typeof vi.fn> };
  externalMentor: { findMany: ReturnType<typeof vi.fn> };
};
const mockCurrentTerm = currentTerm as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("currentProjectParticipantIds", () => {
  it("unions current-term roster with current-cycle external mentors", async () => {
    mockCurrentTerm.mockResolvedValue({ id: "term-1" });
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
    ]);
    mockPrisma.externalMentor.findMany.mockResolvedValue([
      { userId: "mentor" },
      { userId: "u2" }, // overlap dedupes
    ]);

    const ids = await currentProjectParticipantIds("p1");

    expect(ids).toEqual(new Set(["u1", "u2", "mentor"]));
    // Scoped to the current term / that project.
    expect(mockPrisma.projectAssignment.findMany).toHaveBeenCalledWith({
      where: { projectId: "p1", termId: "term-1" },
      select: { userId: true },
    });
    expect(mockPrisma.externalMentor.findMany).toHaveBeenCalledWith({
      where: { projectId: "p1", staffingCycle: { termId: "term-1" } },
      select: { userId: true },
    });
  });

  it("returns an empty set when there is no current term", async () => {
    mockCurrentTerm.mockResolvedValue(null);

    const ids = await currentProjectParticipantIds("p1");

    expect(ids.size).toBe(0);
    expect(mockPrisma.projectAssignment.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.externalMentor.findMany).not.toHaveBeenCalled();
  });
});
