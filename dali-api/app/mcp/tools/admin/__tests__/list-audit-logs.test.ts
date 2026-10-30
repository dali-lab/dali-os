import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    user: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/audit-query", async (orig) => {
  const real = await orig<typeof import("~/lib/audit-query")>();
  return {
    ...real,
    parseAuditFilters: vi.fn(real.parseAuditFilters),
    buildAuditWhere: vi.fn(real.buildAuditWhere),
    resolveAuditTextFilters: vi.fn().mockResolvedValue({}),
  };
});

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { resolveAuditTextFilters } from "~/lib/audit-query";
import { runListAuditLogs, LIST_AUDIT_LOGS_TOOL } from "~/mcp/tools/admin/list-audit-logs";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as {
  auditLog: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

const ENTRY = {
  id: "al-1",
  action: "user.login",
  userId: "u1",
  targetId: null,
  metadata: {},
  createdAt: new Date("2026-08-01T10:00:00Z"),
};

function makeCtx(userId = "u-core"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Core",
      lastName: "Lead",
    },
    scopes: ["mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.auditLog.findMany.mockResolvedValue([ENTRY]);
  mockPrisma.auditLog.count.mockResolvedValue(1);
  vi.mocked(resolveAuditTextFilters).mockResolvedValue({});
});

describe("list_audit_logs", () => {
  it("requires the mcp:admin scope", () => {
    expect(LIST_AUDIT_LOGS_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not isCore", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(runListAuditLogs(makeCtx("u-nobody"), {})).rejects.toMatchObject({
      name: "McpForbiddenError",
      status: 403,
    });
    expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("returns entries and a page with the filtered total on the happy path", async () => {
    const out = await runListAuditLogs(makeCtx(), {});
    expect(out.page).toEqual({ nextCursor: null, hasMore: false, limit: 50, total: 1 });
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].id).toBe("al-1");
  });

  it("clamps limit to 200 and fetches one extra row to detect more", async () => {
    await runListAuditLogs(makeCtx(), { limit: 999 });
    const [call] = mockPrisma.auditLog.findMany.mock.calls;
    expect(call[0].take).toBe(201);
    expect(call[0].skip).toBeUndefined();
  });

  it("passes filter args through parseAuditFilters", async () => {
    await runListAuditLogs(makeCtx(), {
      action: "user.login",
      userId: "u1",
      person: "Alice",
      from: "2026-01-01",
      to: "2026-12-31",
    });
    // resolveAuditTextFilters is called because person is set
    expect(resolveAuditTextFilters).toHaveBeenCalled();
    // findMany should have been called with a where derived from those filters
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalled();
  });

  it("walks pages with the cursor and ends with a null cursor", async () => {
    const a = { ...ENTRY, id: "al-3", createdAt: new Date("2026-08-03T00:00:00Z") };
    const b = { ...ENTRY, id: "al-2", createdAt: new Date("2026-08-02T00:00:00Z") };
    const c = { ...ENTRY, id: "al-1", createdAt: new Date("2026-08-02T00:00:00Z") };
    mockPrisma.auditLog.count.mockResolvedValue(3);
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([a, b, c]);

    const first = await runListAuditLogs(makeCtx(), { limit: 2 });
    expect(first.entries.map((e) => e.id)).toEqual(["al-3", "al-2"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2, total: 3 });

    mockPrisma.auditLog.findMany.mockResolvedValueOnce([c]);
    const second = await runListAuditLogs(makeCtx(), { limit: 2, cursor: first.page.nextCursor! });
    expect(second.entries.map((e) => e.id)).toEqual(["al-1"]);
    expect(second.page.nextCursor).toBeNull();
    expect(second.page.hasMore).toBe(false);

    const where = mockPrisma.auditLog.findMany.mock.calls[1][0].where;
    expect(where.AND[1]).toEqual({
      OR: [
        { createdAt: { lt: new Date("2026-08-02T00:00:00Z") } },
        { createdAt: new Date("2026-08-02T00:00:00Z"), id: { lt: "al-2" } },
      ],
    });
  });

  it("keeps the total on the filters alone, not the cursor", async () => {
    await runListAuditLogs(makeCtx(), { action: "user.login" });
    expect(mockPrisma.auditLog.count.mock.calls[0][0].where.AND).toBeUndefined();
  });

  it("rejects a malformed cursor", async () => {
    await expect(runListAuditLogs(makeCtx(), { cursor: "garbage" })).rejects.toMatchObject({
      name: "McpInvalidError",
    });
  });

  it("orders by createdAt then id, both descending", async () => {
    await runListAuditLogs(makeCtx(), {});
    const [call] = mockPrisma.auditLog.findMany.mock.calls;
    expect(call[0].orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("does not accept offset in the schema", () => {
    expect(LIST_AUDIT_LOGS_TOOL.inputSchema.properties).not.toHaveProperty("offset");
  });

  it("filters by area and does not hide mcp reads by default", async () => {
    await runListAuditLogs(makeCtx(), { area: "staffing" });
    const where = mockPrisma.auditLog.findMany.mock.calls[0][0].where.AND[0];
    expect(where.action.in).toContain("staffing.assign");

    mockPrisma.auditLog.findMany.mockClear();
    await runListAuditLogs(makeCtx(), {});
    expect(mockPrisma.auditLog.findMany.mock.calls[0][0].where.AND[0].action).toBeUndefined();
  });
});
