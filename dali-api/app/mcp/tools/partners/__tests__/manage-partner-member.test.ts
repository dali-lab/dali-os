import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/partners/lib/invites.server", () => ({
  createPartnerInvite: vi.fn(),
  revokePartnerInvite: vi.fn(),
}));
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
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'. Expected one of: ${Object.keys(spec).join(", ")}`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { McpError, McpForbiddenError, McpNotFoundError, McpInvalidError, requireForAction, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { runManagePartnerMember, MANAGE_PARTNER_MEMBER_TOOL } from "../manage-partner-member";

const mockPrisma = prisma as unknown as {
  partnerContact: { findUnique: ReturnType<typeof vi.fn> };
  partnerMembership: { upsert: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  partnerOrg: { update: ReturnType<typeof vi.fn> };
  partnerActivity: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_partner_member", () => {
  it("requires mcp:write scope", () => {
    expect(MANAGE_PARTNER_MEMBER_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManagePartnerMember("u1", { action: "add", orgId: "org-1", contactId: "c1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  describe("add", () => {
    it("404s on an unknown contact", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerContact = { findUnique: vi.fn().mockResolvedValue(null) };
      await expect(
        runManagePartnerMember("u1", { action: "add", orgId: "org-1", contactId: "missing" }),
      ).rejects.toMatchObject({ name: "McpNotFoundError" });
    });

    it("upserts the membership and logs MemberAdded", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerContact = { findUnique: vi.fn().mockResolvedValue({ id: "c1" }) };
      mockPrisma.partnerMembership = { upsert: vi.fn().mockResolvedValue({}), findFirst: vi.fn() };
      mockPrisma.partnerActivity = { create: vi.fn() };

      const out = await runManagePartnerMember("u1", { action: "add", orgId: "org-1", contactId: "c1" });
      expect(out).toMatchObject({ ok: true });
      expect(mockPrisma.partnerMembership.upsert).toHaveBeenCalledWith({
        where: { contactId_orgId: { contactId: "c1", orgId: "org-1" } },
        create: { contactId: "c1", orgId: "org-1" },
        update: { endedAt: null },
      });
    });
  });

  describe("set_primary", () => {
    it("requires membershipId", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      await expect(
        runManagePartnerMember("u1", { action: "set_primary", orgId: "org-1" }),
      ).rejects.toMatchObject({ name: "McpInvalidError" });
    });

    it("404s when the membership isn't an active member of this org", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerMembership = { upsert: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) };
      await expect(
        runManagePartnerMember("u1", { action: "set_primary", orgId: "org-1", membershipId: "m1" }),
      ).rejects.toMatchObject({ name: "McpNotFoundError" });
    });

    it("sets the org's primaryContactId", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerMembership = {
        upsert: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({ id: "m1" }),
      };
      mockPrisma.partnerOrg = { update: vi.fn().mockResolvedValue({}) };

      const out = await runManagePartnerMember("u1", {
        action: "set_primary",
        orgId: "org-1",
        membershipId: "m1",
      });
      expect(out).toMatchObject({ ok: true });
      expect(mockPrisma.partnerOrg.update).toHaveBeenCalledWith({
        where: { id: "org-1" },
        data: { primaryContactId: "m1" },
      });
    });
  });
});
