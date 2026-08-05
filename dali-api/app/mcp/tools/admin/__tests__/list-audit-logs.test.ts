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

  it("returns entries, total, limit, and offset on happy path", async () => {
    const out = await runListAuditLogs(makeCtx(), {});
    expect(out.total).toBe(1);
    expect(out.limit).toBe(50);
    expect(out.offset).toBe(0);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].id).toBe("al-1");
  });

  it("clamps limit to 1–200 and floors offset at 0", async () => {
    await runListAuditLogs(makeCtx(), { limit: 999, offset: -5 });
    const [call] = mockPrisma.auditLog.findMany.mock.calls;
    expect(call[0].take).toBe(200);
    expect(call[0].skip).toBe(0);
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

  it("paginates correctly when offset and limit are provided", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(100);

    const out = await runListAuditLogs(makeCtx(), { limit: 10, offset: 20 });
    expect(out.limit).toBe(10);
    expect(out.offset).toBe(20);
    const [call] = mockPrisma.auditLog.findMany.mock.calls;
    expect(call[0].take).toBe(10);
    expect(call[0].skip).toBe(20);
  });

  it("orders results by createdAt descending", async () => {
    await runListAuditLogs(makeCtx(), {});
    const [call] = mockPrisma.auditLog.findMany.mock.calls;
    expect(call[0].orderBy).toEqual({ createdAt: "desc" });
  });
});
