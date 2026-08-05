import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    projectAssignment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    domainEligibility: { findUnique: vi.fn() },
    mentorshipPair: { count: vi.fn() },
  },
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  runCorrectAssignmentLevel,
  CORRECT_ASSIGNMENT_LEVEL_TOOL,
} from "~/mcp/tools/projects-extra/correct-assignment-level";

const mockPrisma = prisma as unknown as {
  projectAssignment: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  domainEligibility: { findUnique: ReturnType<typeof vi.fn> };
  mentorshipPair: { count: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("correct_assignment_level", () => {
  it("requires mcp:admin scope", () => {
    expect(CORRECT_ASSIGNMENT_LEVEL_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError for non-Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runCorrectAssignmentLevel("u1", { assignmentId: "a1", level: "P2" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws McpNotFoundError for unknown assignment", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.projectAssignment.findUnique.mockResolvedValue(null);
    await expect(
      runCorrectAssignmentLevel("u1", { assignmentId: "a-nope", level: "P2" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("returns unchanged:true when level is the same", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.projectAssignment.findUnique.mockResolvedValue({
      id: "a1",
      userId: "u2",
      projectId: "p1",
      termId: "t1",
      domainId: "d1",
      level: "P2",
      domain: { displayName: "Design" },
    });
    const out = await runCorrectAssignmentLevel("u1", { assignmentId: "a1", level: "P2" });
    expect(out).toMatchObject({ ok: true, unchanged: true });
    expect(mockPrisma.projectAssignment.update).not.toHaveBeenCalled();
  });

  it("rejects promotion above eligibility ceiling", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.projectAssignment.findUnique.mockResolvedValue({
      id: "a1",
      userId: "u2",
      projectId: "p1",
      termId: "t1",
      domainId: "d1",
      level: "P1",
      domain: { displayName: "Design" },
    });
    mockPrisma.domainEligibility.findUnique.mockResolvedValue({ level: "P2" });
    await expect(
      runCorrectAssignmentLevel("u1", { assignmentId: "a1", level: "P3" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("rejects demotion while member is actively mentoring", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.projectAssignment.findUnique.mockResolvedValue({
      id: "a1",
      userId: "u2",
      projectId: "p1",
      termId: "t1",
      domainId: "d1",
      level: "P3",
      domain: { displayName: "Design" },
    });
    mockPrisma.domainEligibility.findUnique.mockResolvedValue({ level: "P3" });
    mockPrisma.mentorshipPair.count.mockResolvedValue(2);
    await expect(
      runCorrectAssignmentLevel("u1", { assignmentId: "a1", level: "P2" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("happy path: updates level within eligibility", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.projectAssignment.findUnique.mockResolvedValue({
      id: "a1",
      userId: "u2",
      projectId: "p1",
      termId: "t1",
      domainId: "d1",
      level: "P1",
      domain: { displayName: "Design" },
    });
    mockPrisma.domainEligibility.findUnique.mockResolvedValue({ level: "P3" });
    mockPrisma.projectAssignment.update.mockResolvedValue({});
    const out = await runCorrectAssignmentLevel("u1", { assignmentId: "a1", level: "P2" });
    expect(out).toMatchObject({ ok: true, level: "P2" });
    expect(mockPrisma.projectAssignment.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { level: "P2" },
    });
  });
});
