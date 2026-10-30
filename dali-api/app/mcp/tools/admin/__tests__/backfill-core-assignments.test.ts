import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db";
import { isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  runBackfillCoreAssignments,
  BACKFILL_CORE_ASSIGNMENTS_TOOL,
} from "~/mcp/tools/admin/backfill-core-assignments";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ctx = { user: { id: "admin-u1" }, request: new Request("https://example.com") } as unknown as McpCtx;
const ids = (...v: string[]) => v.map((id) => ({ id }));
const ROW = { userId: "u1", termId: "t1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  mockPrisma.user.findMany.mockResolvedValue(ids("u1", "u2"));
  mockPrisma.term.findMany.mockResolvedValue(ids("t1"));
  mockPrisma.coreAssignment = {
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
});

describe("backfill_core_assignments", () => {
  it("requires the mcp:admin scope", () => {
    expect(BACKFILL_CORE_ASSIGNMENTS_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("rejects a non-admin and writes nothing", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    await expect(runBackfillCoreAssignments(ctx, { assignments: [ROW] })).rejects.toThrow("Only admins");
    expect(mockPrisma.coreAssignment.createMany).not.toHaveBeenCalled();
  });

  it("writes untitled rows flagged as backfilled", async () => {
    const result = await runBackfillCoreAssignments(ctx, { assignments: [ROW] });
    expect(mockPrisma.coreAssignment.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u1", termId: "t1", leadTitle: null, backfilled: true }],
    });
    expect(result).toEqual({ ok: true, rows: 1, created: 1, skipped: 0 });
  });

  it("skips a member who already has any Core row in the term, titled or not", async () => {
    mockPrisma.coreAssignment.findMany.mockResolvedValue([ROW]);
    const result = await runBackfillCoreAssignments(ctx, {
      assignments: [ROW, { userId: "u2", termId: "t1" }],
    });
    expect(mockPrisma.coreAssignment.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u2", termId: "t1", leadTitle: null, backfilled: true }],
    });
    expect(result).toEqual({ ok: true, rows: 2, created: 1, skipped: 1 });
  });

  it("writes nothing when every row already exists", async () => {
    mockPrisma.coreAssignment.findMany.mockResolvedValue([ROW]);
    await runBackfillCoreAssignments(ctx, { assignments: [ROW] });
    expect(mockPrisma.coreAssignment.createMany).not.toHaveBeenCalled();
  });

  it("collapses duplicate rows in the input", async () => {
    const result = await runBackfillCoreAssignments(ctx, { assignments: [ROW, { ...ROW }] });
    expect(result).toEqual({ ok: true, rows: 1, created: 1, skipped: 0 });
  });

  it("rejects unknown users and terms and writes nothing", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.term.findMany.mockResolvedValue([]);
    await expect(runBackfillCoreAssignments(ctx, { assignments: [ROW] })).rejects.toThrow(
      "Unknown userId(s): u1. Unknown termId(s): t1.",
    );
    expect(mockPrisma.coreAssignment.createMany).not.toHaveBeenCalled();
  });

  it("logs an audit event", async () => {
    await runBackfillCoreAssignments(ctx, { assignments: [ROW] });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "core.assignment.backfill" }),
    );
  });
});
