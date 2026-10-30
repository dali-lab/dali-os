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
  mockPrisma.projectAssignment = { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) };
  mockPrisma.coreAssignment = { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) };
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

  it("reads project assignments only for the given terms", async () => {
    await runGetBackfillState(ctx, { termIds: ["t1", "t2"] });
    const where = { termId: { in: ["t1", "t2"] } };
    expect(mockPrisma.projectAssignment.findMany.mock.calls[0][0].where.AND[0]).toEqual(where);
    expect(mockPrisma.projectAssignment.count).toHaveBeenCalledWith({ where });
    expect(mockPrisma.coreAssignment.findMany).not.toHaveBeenCalled();
  });

  it("reads core assignments, with their ids, when assignments is core", async () => {
    await runGetBackfillState(ctx, { termIds: ["t1"], assignments: "core" });
    const call = mockPrisma.coreAssignment.findMany.mock.calls[0][0];
    expect(call.where.AND[0]).toEqual({ termId: { in: ["t1"] } });
    expect(call.select.id).toBe(true);
    expect(call.orderBy).toEqual([{ id: "asc" }]);
    expect(mockPrisma.projectAssignment.findMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown assignments kind", async () => {
    await expect(
      runGetBackfillState(ctx, { termIds: ["t1"], assignments: "both" as never }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("does not read assignments without terms", async () => {
    const result = await runGetBackfillState(ctx, {});
    expect(mockPrisma.projectAssignment.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.coreAssignment.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      members: [],
      projectAssignments: [],
      coreAssignments: null,
      page: { nextCursor: null, hasMore: false, limit: 50, total: 0 },
    });
  });

  it("nulls the kind that was not requested", async () => {
    const project = await runGetBackfillState(ctx, { termIds: ["t1"] });
    expect(project.projectAssignments).toEqual([]);
    expect(project.coreAssignments).toBeNull();
    const core = await runGetBackfillState(ctx, { termIds: ["t1"], assignments: "core" });
    expect(core.projectAssignments).toBeNull();
    expect(core.coreAssignments).toEqual([]);
  });

  it("walks project assignments with the cursor and ends with a null cursor", async () => {
    const row = (id: string) => ({ id, userId: "u", projectId: "p", termId: "t1", domainId: "d", level: "Dev" });
    mockPrisma.projectAssignment.count.mockResolvedValue(3);
    mockPrisma.projectAssignment.findMany.mockResolvedValueOnce([row("a1"), row("a2"), row("a3")]);

    const first = await runGetBackfillState(ctx, { termIds: ["t1"], limit: 2 });
    expect(first.projectAssignments!.map((r) => (r as { id: string }).id)).toEqual(["a1", "a2"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2, total: 3 });

    mockPrisma.projectAssignment.findMany.mockResolvedValueOnce([row("a3")]);
    const second = await runGetBackfillState(ctx, { termIds: ["t1"], limit: 2, cursor: first.page.nextCursor! });
    expect(second.projectAssignments).toHaveLength(1);
    expect(second.page).toEqual({ nextCursor: null, hasMore: false, limit: 2, total: 3 });
    expect(mockPrisma.projectAssignment.findMany.mock.calls[1][0].where.AND[1]).toEqual({
      OR: [{ id: { gt: "a2" } }],
    });
  });

  it("returns members on the first page only", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1", netId: "f00abcd", firstName: "Ada", lastName: "L" }]);
    const first = await runGetBackfillState(ctx, { netIds: ["f00abcd"], termIds: ["t1"] });
    expect(first.members).toHaveLength(1);

    const cursor = Buffer.from(JSON.stringify({ k: ["a2"] }), "utf8").toString("base64url");
    mockPrisma.user.findMany.mockClear();
    const next = await runGetBackfillState(ctx, { netIds: ["f00abcd"], termIds: ["t1"], cursor });
    expect(next.members).toEqual([]);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });
});
