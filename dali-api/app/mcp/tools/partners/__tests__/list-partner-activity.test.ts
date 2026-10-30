import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, canViewStaffing: vi.fn() };
});
vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  return { McpError, McpForbiddenError, McpNotFoundError, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});

import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import { runListPartnerActivity, LIST_PARTNER_ACTIVITY_TOOL } from "../list-partner-activity";

const mockPrisma = prisma as unknown as {
  partnerOrg: { findUnique: ReturnType<typeof vi.fn> };
  partnerActivity: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

const row = (id: string, day: number) => ({
  id,
  createdAt: new Date(`2026-09-${String(day).padStart(2, "0")}T00:00:00Z`),
  type: "Note",
  body: "hi",
  metadata: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canViewStaffing).mockResolvedValue(true);
  mockPrisma.partnerOrg = { findUnique: vi.fn().mockResolvedValue({ id: "org-1" }) };
  mockPrisma.partnerActivity = {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  };
});

describe("list_partner_activity", () => {
  it("requires mcp:read scope", () => {
    expect(LIST_PARTNER_ACTIVITY_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects non-staffing callers", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(false);
    await expect(runListPartnerActivity("u1", { orgId: "org-1" })).rejects.toMatchObject({
      name: "McpForbiddenError",
    });
    expect(mockPrisma.partnerActivity.findMany).not.toHaveBeenCalled();
  });

  it("404s on a missing org", async () => {
    mockPrisma.partnerOrg.findUnique.mockResolvedValue(null);
    await expect(runListPartnerActivity("u1", { orgId: "nope" })).rejects.toMatchObject({
      name: "McpNotFoundError",
    });
  });

  it("walks past the 20 rows get_partner_org shows, ending with a null cursor", async () => {
    mockPrisma.partnerActivity.count.mockResolvedValue(3);
    mockPrisma.partnerActivity.findMany.mockResolvedValueOnce([row("a3", 3), row("a2", 2), row("a1", 1)]);

    const first = await runListPartnerActivity("u1", { orgId: "org-1", limit: 2 });
    expect((first.activity as { id: string }[]).map((a) => a.id)).toEqual(["a3", "a2"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2, total: 3 });
    expect(mockPrisma.partnerActivity.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
    });

    mockPrisma.partnerActivity.findMany.mockResolvedValueOnce([row("a1", 1)]);
    const second = await runListPartnerActivity("u1", { orgId: "org-1", limit: 2, cursor: first.page.nextCursor! });
    expect((second.activity as { id: string }[]).map((a) => a.id)).toEqual(["a1"]);
    expect(second.page).toEqual({ nextCursor: null, hasMore: false, limit: 2, total: 3 });
    expect(mockPrisma.partnerActivity.findMany.mock.calls[1][0].where.AND[1]).toEqual({
      OR: [
        { createdAt: { lt: new Date("2026-09-02T00:00:00Z") } },
        { createdAt: new Date("2026-09-02T00:00:00Z"), id: { lt: "a2" } },
      ],
    });
  });

  it("scopes the rows and the total to the org", async () => {
    await runListPartnerActivity("u1", { orgId: "org-1" });
    expect(mockPrisma.partnerActivity.count).toHaveBeenCalledWith({ where: { orgId: "org-1" } });
    expect(mockPrisma.partnerActivity.findMany.mock.calls[0][0].where.AND[0]).toEqual({ orgId: "org-1" });
  });
});
