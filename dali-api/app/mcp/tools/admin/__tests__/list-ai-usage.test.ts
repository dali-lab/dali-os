import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    aiUsage: { groupBy: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { runListAiUsage, LIST_AI_USAGE_TOOL } from "~/mcp/tools/admin/list-ai-usage";
import type { McpCtx } from "~/mcp/registry";

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

const GROUP_ROW = {
  userId: "u-1",
  _sum: { count: 10, inputTokens: 5000, outputTokens: 2000 },
  _max: { day: "2026-09-10" },
};

const USER_ROW = {
  id: "u-1",
  firstName: "Alice",
  lastName: "Smith",
  daliEmail: "alice@dali.dartmouth.edu",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  (prisma.aiUsage.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([GROUP_ROW]);
  (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([USER_ROW]);
});

describe("list_ai_usage", () => {
  it("requires mcp:admin scope", () => {
    expect(LIST_AI_USAGE_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(runListAiUsage(makeCtx("u-nobody"), {})).rejects.toMatchObject({
      name: "McpForbiddenError",
      status: 403,
    });
    expect(prisma.aiUsage.groupBy).not.toHaveBeenCalled();
  });

  it("returns per-user rows and totals on happy path", async () => {
    const out = await runListAiUsage(makeCtx(), {});
    expect(out.rangeDays).toBe(30);
    expect(out.totals).toEqual({ requests: 10, inputTokens: 5000, outputTokens: 2000 });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      userId: "u-1",
      name: "Alice Smith",
      email: "alice@dali.dartmouth.edu",
      requests: 10,
      inputTokens: 5000,
      outputTokens: 2000,
      lastUsed: "2026-09-10",
    });
  });

  it("defaults to 30 days when rangeDays is omitted", async () => {
    await runListAiUsage(makeCtx(), {});
    expect(prisma.aiUsage.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ day: expect.objectContaining({ gte: expect.any(String) }) }) }),
    );
  });

  it("uses 7 days when rangeDays=7", async () => {
    const out = await runListAiUsage(makeCtx(), { rangeDays: 7 });
    expect(out.rangeDays).toBe(7);
  });

  it("uses 90 days when rangeDays=90", async () => {
    const out = await runListAiUsage(makeCtx(), { rangeDays: 90 });
    expect(out.rangeDays).toBe(90);
  });

  it("falls back to 30 days for invalid rangeDays", async () => {
    const out = await runListAiUsage(makeCtx(), { rangeDays: 15 as any });
    expect(out.rangeDays).toBe(30);
  });

  it("returns zero totals and empty rows when no usage data", async () => {
    (prisma.aiUsage.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const out = await runListAiUsage(makeCtx(), {});
    expect(out.rows).toEqual([]);
    expect(out.totals).toEqual({ requests: 0, inputTokens: 0, outputTokens: 0 });
    // Should not query users when no user IDs
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("falls back to userId as name when user not found", async () => {
    (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const out = await runListAiUsage(makeCtx(), {});
    expect(out.rows[0].name).toBe("u-1");
    expect(out.rows[0].email).toBeNull();
  });
});
