import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({
  isAdmin: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { runManageGroup, MANAGE_GROUP_TOOL } from "~/mcp/tools/admin/manage-group";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_group", () => {
  it("requires the mcp:admin scope", () => {
    expect(MANAGE_GROUP_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws Forbidden when caller is not an admin", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    await expect(
      runManageGroup(makeCtx(), { action: "create", name: "Test", staticMemberIds: ["u1"] }),
    ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
  });

  describe("create", () => {
    it("creates a Static group and logs an audit event", async () => {
      vi.mocked(isAdmin).mockResolvedValue(true);
      const created = { id: "g-new", name: "Alpha Team", type: "Static", staticMemberIds: ["u1", "u2"] };
      mockPrisma.groupDefinition.create.mockResolvedValue(created);

      const out = await runManageGroup(makeCtx(), {
        action: "create",
        name: "Alpha Team",
        staticMemberIds: ["u1", "u2"],
      });

      expect(mockPrisma.groupDefinition.create).toHaveBeenCalledWith({
        data: { name: "Alpha Team", type: "Static", staticMemberIds: ["u1", "u2"] },
      });
      expect(out).toMatchObject({ id: "g-new", name: "Alpha Team" });
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "group.create", targetId: "g-new" }),
      );
    });

    it("rejects when staticMemberIds is empty", async () => {
      vi.mocked(isAdmin).mockResolvedValue(true);
      await expect(
        runManageGroup(makeCtx(), { action: "create", name: "Empty", staticMemberIds: [] }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });
  });

  describe("delete", () => {
    it("deletes a non-system group and logs an audit event", async () => {
      vi.mocked(isAdmin).mockResolvedValue(true);
      mockPrisma.groupDefinition.findUnique.mockResolvedValue({ systemKey: null });
      mockPrisma.groupDefinition.delete.mockResolvedValue({ id: "g1" });

      const out = await runManageGroup(makeCtx(), { action: "delete", groupId: "g1" });

      expect(mockPrisma.groupDefinition.delete).toHaveBeenCalledWith({ where: { id: "g1" } });
      expect(out).toEqual({ ok: true });
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "group.delete", targetId: "g1" }),
      );
    });

    it("blocks deletion of system-managed groups", async () => {
      vi.mocked(isAdmin).mockResolvedValue(true);
      mockPrisma.groupDefinition.findUnique.mockResolvedValue({ systemKey: "core" });

      await expect(
        runManageGroup(makeCtx(), { action: "delete", groupId: "g-sys" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
      expect(mockPrisma.groupDefinition.delete).not.toHaveBeenCalled();
    });

    it("throws NotFound when group does not exist", async () => {
      vi.mocked(isAdmin).mockResolvedValue(true);
      mockPrisma.groupDefinition.findUnique.mockResolvedValue(null);

      await expect(
        runManageGroup(makeCtx(), { action: "delete", groupId: "nope" }),
      ).rejects.toMatchObject({ name: "McpNotFoundError", status: 404 });
    });
  });
});
