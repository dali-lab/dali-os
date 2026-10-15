import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db";
import { isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  runBackfillProjectAssignments,
  BACKFILL_PROJECT_ASSIGNMENTS_TOOL,
} from "~/mcp/tools/admin/backfill-project-assignments";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

function makeCtx(userId = "admin-u1"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Admin",
      lastName: "User",
    },
    scopes: ["mcp:admin"],
    request: new Request("https://example.com"),
  };
}

const ROW = { userId: "u1", projectId: "p1", termId: "t1", domainId: "d1", level: "P2" as const };
const ids = (...v: string[]) => v.map((id) => ({ id }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  mockPrisma.user.findMany.mockResolvedValue(ids("u1", "u2"));
  mockPrisma.project.findMany.mockResolvedValue(ids("p1", "p2"));
  mockPrisma.term.findMany.mockResolvedValue(ids("t1"));
  mockPrisma.domain.findMany.mockResolvedValue(ids("d1"));
  mockPrisma.projectAssignment = {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
  };
  mockPrisma.projectTerm = { createMany: vi.fn().mockResolvedValue({ count: 0 }) };
  mockPrisma.domainEligibility = {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockPrisma.$transaction = vi.fn(async (fn: any) => fn(mockPrisma));
});

describe("backfill_project_assignments", () => {
  it("requires the mcp:admin scope", () => {
    expect(BACKFILL_PROJECT_ASSIGNMENTS_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws Forbidden and writes nothing for a non-admin", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    await expect(
      runBackfillProjectAssignments(makeCtx(), { assignments: [ROW] }),
    ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("names every unknown id in one InvalidError", async () => {
    mockPrisma.user.findMany.mockResolvedValue(ids("u1"));
    mockPrisma.term.findMany.mockResolvedValue([]);
    const err = await runBackfillProjectAssignments(makeCtx(), {
      assignments: [ROW, { ...ROW, userId: "ghost-a" }, { ...ROW, userId: "ghost-b" }],
    }).catch((e) => e);
    expect(err).toMatchObject({ name: "McpInvalidError", status: 400 });
    expect(err.message).toBe("Unknown userId(s): ghost-a, ghost-b. Unknown termId(s): t1.");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("counts created and updated rows from one existing-rows read", async () => {
    mockPrisma.projectAssignment.findMany.mockResolvedValue([
      { userId: "u1", projectId: "p1", termId: "t1", domainId: "d1" },
    ]);
    const out = await runBackfillProjectAssignments(makeCtx(), {
      assignments: [ROW, { ...ROW, userId: "u2" }],
    });
    expect(mockPrisma.projectAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.projectAssignment.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.projectAssignment.upsert).toHaveBeenCalledWith({
      where: {
        userId_projectId_termId_domainId: {
          userId: "u1",
          projectId: "p1",
          termId: "t1",
          domainId: "d1",
        },
      },
      update: { level: "P2" },
      create: ROW,
    });
    expect(out).toMatchObject({ ok: true, rows: 2, created: 1, updated: 1 });
  });

  it("collapses duplicate rows and lets the last level win", async () => {
    const out = await runBackfillProjectAssignments(makeCtx(), {
      assignments: [ROW, { ...ROW, level: "P3" }, ROW],
    });
    expect(mockPrisma.projectAssignment.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.projectAssignment.upsert.mock.calls[0][0].update).toEqual({ level: "P2" });
    expect(out.rows).toBe(1);

    mockPrisma.projectAssignment.upsert.mockClear();
    await runBackfillProjectAssignments(makeCtx(), {
      assignments: [ROW, { ...ROW, level: "P3" }],
    });
    expect(mockPrisma.projectAssignment.upsert.mock.calls[0][0].update).toEqual({ level: "P3" });
  });

  describe("project terms", () => {
    it("creates distinct pairs with skipDuplicates and reports the count", async () => {
      mockPrisma.projectTerm.createMany.mockResolvedValue({ count: 2 });
      const out = await runBackfillProjectAssignments(makeCtx(), {
        assignments: [ROW, { ...ROW, userId: "u2" }, { ...ROW, projectId: "p2" }],
      });
      expect(mockPrisma.projectTerm.createMany).toHaveBeenCalledWith({
        data: [
          { projectId: "p1", termId: "t1" },
          { projectId: "p2", termId: "t1" },
        ],
        skipDuplicates: true,
      });
      expect(out.projectTermsAdded).toBe(2);
    });

    it("is skipped when addProjectTerms is false", async () => {
      const out = await runBackfillProjectAssignments(makeCtx(), {
        assignments: [ROW],
        addProjectTerms: false,
      });
      expect(mockPrisma.projectTerm.createMany).not.toHaveBeenCalled();
      expect(out.projectTermsAdded).toBe(0);
    });
  });

  describe("eligibility", () => {
    it("is created when missing, stamped with the caller", async () => {
      const out = await runBackfillProjectAssignments(makeCtx("admin-u7"), { assignments: [ROW] });
      expect(mockPrisma.domainEligibility.upsert).toHaveBeenCalledWith({
        where: { userId_domainId: { userId: "u1", domainId: "d1" } },
        update: { level: "P2", promotedAt: expect.any(Date), promotedBy: "admin-u7" },
        create: { userId: "u1", domainId: "d1", level: "P2", promotedBy: "admin-u7" },
      });
      expect(out.eligibilityRaised).toBe(1);
    });

    it("is raised when lower", async () => {
      mockPrisma.domainEligibility.findMany.mockResolvedValue([
        { userId: "u1", domainId: "d1", level: "P1" },
      ]);
      const out = await runBackfillProjectAssignments(makeCtx(), { assignments: [ROW] });
      expect(mockPrisma.domainEligibility.upsert).toHaveBeenCalledTimes(1);
      expect(out.eligibilityRaised).toBe(1);
    });

    it.each(["P2", "P3"])("is left alone when already %s", async (have) => {
      mockPrisma.domainEligibility.findMany.mockResolvedValue([
        { userId: "u1", domainId: "d1", level: have },
      ]);
      const out = await runBackfillProjectAssignments(makeCtx(), { assignments: [ROW] });
      expect(mockPrisma.domainEligibility.upsert).not.toHaveBeenCalled();
      expect(out.eligibilityRaised).toBe(0);
    });

    it("uses the max level per user and domain across the batch", async () => {
      mockPrisma.term.findMany.mockResolvedValue(ids("t1", "t2"));
      await runBackfillProjectAssignments(makeCtx(), {
        assignments: [
          { ...ROW, level: "P1" },
          { ...ROW, termId: "t2", level: "P3" },
        ],
      });
      expect(mockPrisma.domainEligibility.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.domainEligibility.upsert.mock.calls[0][0].create.level).toBe("P3");
    });

    it("is skipped when raiseEligibility is false", async () => {
      const out = await runBackfillProjectAssignments(makeCtx(), {
        assignments: [ROW],
        raiseEligibility: false,
      });
      expect(mockPrisma.domainEligibility.findMany).not.toHaveBeenCalled();
      expect(out.eligibilityRaised).toBe(0);
    });
  });

  it("logs an audit event with the summary", async () => {
    await runBackfillProjectAssignments(makeCtx("admin-u7"), { assignments: [ROW] });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.assignment.backfill",
        userId: "admin-u7",
        metadata: { rows: 1, created: 1, updated: 0, projectTermsAdded: 0, eligibilityRaised: 1 },
      }),
    );
  });
});
