import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));

import { prisma } from "~/lib/db";
import { isAdmin } from "~/lib/roles";
import { runGetBackfillState, GET_BACKFILL_STATE_TOOL } from "~/mcp/tools/admin/get-backfill-state";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ctx = { user: { id: "admin-u1" } } as unknown as McpCtx;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.projectAssignment = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.coreAssignment = { findMany: vi.fn().mockResolvedValue([]) };
});

describe("get_backfill_state", () => {
  it("requires the mcp:admin scope", () => {
    expect(GET_BACKFILL_STATE_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("rejects a non-admin", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    await expect(runGetBackfillState(ctx, { netIds: ["f00abcd"] })).rejects.toThrow("Only admins");
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("never reads the user table without NetIDs to match", async () => {
    await runGetBackfillState(ctx, { termIds: ["t1"] });
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("selects only id, NetID, and name", async () => {
    await runGetBackfillState(ctx, { netIds: ["f00abcd"] });
    expect(mockPrisma.user.findMany.mock.calls[0][0].select).toEqual({
      id: true,
      netId: true,
      firstName: true,
      lastName: true,
    });
  });

  it("matches NetIDs stored in either case", async () => {
    await runGetBackfillState(ctx, { netIds: [" F00abCD "] });
    expect(mockPrisma.user.findMany.mock.calls[0][0].where).toEqual({
      netId: { in: ["f00abcd", "F00ABCD"] },
    });
  });

  it("reads assignments only for the given terms", async () => {
    await runGetBackfillState(ctx, { termIds: ["t1", "t2"] });
    const where = { termId: { in: ["t1", "t2"] } };
    expect(mockPrisma.projectAssignment.findMany.mock.calls[0][0].where).toEqual(where);
    expect(mockPrisma.coreAssignment.findMany.mock.calls[0][0].where).toEqual(where);
  });

  it("does not read assignments without terms", async () => {
    const result = await runGetBackfillState(ctx, {});
    expect(mockPrisma.projectAssignment.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.coreAssignment.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ members: [], projectAssignments: [], coreAssignments: [] });
  });
});
