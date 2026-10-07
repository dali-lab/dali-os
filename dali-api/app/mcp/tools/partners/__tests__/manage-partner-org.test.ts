import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
// Stub the registry so the BY_NAME map side-effect doesn't pull in every
// tool module. We only need the error classes here.
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
import { runManagePartnerOrg, MANAGE_PARTNER_ORG_TOOL } from "../manage-partner-org";

const mockPrisma = prisma as unknown as {
  partnerOrg: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  partnerMembership: {
    count?: ReturnType<typeof vi.fn>;
    findFirst?: ReturnType<typeof vi.fn>;
    findMany?: ReturnType<typeof vi.fn>;
  };
  projectPartner: { count?: ReturnType<typeof vi.fn>; findMany?: ReturnType<typeof vi.fn> };
  partnerApplication: { count: ReturnType<typeof vi.fn> };
  partnerInvite: {
    count: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_partner_org", () => {
  it("requires mcp:write scope", () => {
    expect(MANAGE_PARTNER_ORG_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManagePartnerOrg("u1", { action: "create", name: "Acme" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws for unknown action", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManagePartnerOrg("u1", { action: "explode" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("creates an org and returns id + name", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerOrg = {
      create: vi.fn().mockResolvedValue({ id: "org-new", name: "Acme" }),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const out = await runManagePartnerOrg("u1", { action: "create", name: "Acme" });
    expect(out).toMatchObject({ id: "org-new", name: "Acme" });
    expect(mockPrisma.partnerOrg.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Acme" }) }),
    );
  });

  it("create requires name", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(
      runManagePartnerOrg("u1", { action: "create" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("delete throws when org has members", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerOrg = {
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ id: "org-1" }),
      update: vi.fn(),
      delete: vi.fn(),
    };
    mockPrisma.partnerMembership = {
      count: vi.fn().mockResolvedValue(2),
      findFirst: vi.fn(),
    };
    mockPrisma.projectPartner = { count: vi.fn().mockResolvedValue(0) };
    mockPrisma.partnerApplication = { count: vi.fn().mockResolvedValue(0) };
    mockPrisma.partnerInvite = { count: vi.fn().mockResolvedValue(0), deleteMany: vi.fn() };

    await expect(
      runManagePartnerOrg("u1", { action: "delete", orgId: "org-1" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("delete returns ok for an empty org", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerOrg = {
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ id: "org-1" }),
      update: vi.fn(),
      delete: vi.fn(),
    };
    mockPrisma.partnerMembership = { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() };
    mockPrisma.projectPartner = { count: vi.fn().mockResolvedValue(0) };
    mockPrisma.partnerApplication = { count: vi.fn().mockResolvedValue(0) };
    mockPrisma.partnerInvite = {
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue({}),
    };
    mockPrisma.$transaction = vi.fn().mockImplementation(async (fn: unknown) => {
      const cb = fn as (tx: typeof prisma) => Promise<unknown>;
      return cb({
        partnerInvite: { deleteMany: vi.fn() },
        partnerOrg: { delete: vi.fn() },
      } as unknown as typeof prisma);
    });

    const out = await runManagePartnerOrg("u1", { action: "delete", orgId: "org-1" });
    expect(out).toMatchObject({ ok: true });
  });

  it("delete returns McpNotFoundError when org doesn't exist", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.partnerOrg = {
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      delete: vi.fn(),
    };
    await expect(
      runManagePartnerOrg("u1", { action: "delete", orgId: "missing" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  describe("update", () => {
    it("writes the CRM fields and logs OrgUpdated", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerOrg = {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ id: "org-1" }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn(),
      };

      const out = await runManagePartnerOrg("u1", {
        action: "update",
        orgId: "org-1",
        name: "Acme",
        type: "Company",
        tags: ["ai"],
        showcaseConsent: true,
      });
      expect(out).toMatchObject({ ok: true });
      expect(mockPrisma.partnerOrg.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: "Company", tags: ["ai"], showcaseConsent: true }),
        }),
      );
    });

    it("rejects an invalid type", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerOrg = {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ id: "org-1" }),
        update: vi.fn(),
        delete: vi.fn(),
      };
      await expect(
        runManagePartnerOrg("u1", { action: "update", orgId: "org-1", name: "Acme", type: "NotAType" }),
      ).rejects.toMatchObject({ name: "McpInvalidError" });
    });
  });

  describe("merge_into", () => {
    it("requires a different survivorOrgId", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      await expect(
        runManagePartnerOrg("u1", { action: "merge_into", orgId: "org-1", survivorOrgId: "org-1" }),
      ).rejects.toMatchObject({ name: "McpInvalidError" });
    });

    it("repoints memberships and project links, dedupes, then deletes the source org", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerOrg = {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
          where.id === "org-1"
            ? Promise.resolve({ id: "org-1", name: "Duplicate Inc" })
            : Promise.resolve({ id: "org-2" }),
        ),
        update: vi.fn(),
        delete: vi.fn(),
      };
      mockPrisma.partnerMembership = {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: "m1", contactId: "c1" }, { id: "m2", contactId: "c2" }])
          .mockResolvedValueOnce([{ contactId: "c2" }]),
        findFirst: vi.fn(),
      };
      mockPrisma.projectPartner = {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: "pp1", projectId: "proj-1" }, { id: "pp2", projectId: "proj-2" }])
          .mockResolvedValueOnce([{ projectId: "proj-2" }]),
        count: vi.fn(),
      };

      const tx = {
        partnerMembership: { updateMany: vi.fn() },
        projectPartner: { updateMany: vi.fn(), deleteMany: vi.fn() },
        partnerApplication: { updateMany: vi.fn() },
        partnerActivity: { updateMany: vi.fn(), create: vi.fn() },
        partnerInvite: { updateMany: vi.fn() },
        partnerInvoice: { updateMany: vi.fn() },
        partnerOrg: { delete: vi.fn() },
      };
      mockPrisma.$transaction = vi.fn().mockImplementation(async (fn: unknown) => {
        const cb = fn as (txArg: typeof tx) => Promise<unknown>;
        return cb(tx);
      });

      const out = await runManagePartnerOrg("u1", {
        action: "merge_into",
        orgId: "org-1",
        survivorOrgId: "org-2",
      });
      expect(out).toMatchObject({ ok: true, survivorOrgId: "org-2" });
      // m2's contact is already on the survivor — only m1 repoints.
      expect(tx.partnerMembership.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["m1"] } },
        data: { orgId: "org-2" },
      });
      // pp2's project is already on the survivor — it's removed, not repointed.
      expect(tx.projectPartner.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["pp1"] } },
        data: { partnerOrgId: "org-2" },
      });
      expect(tx.projectPartner.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["pp2"] } },
      });
      expect(tx.partnerOrg.delete).toHaveBeenCalledWith({ where: { id: "org-1" } });
    });

    it("404s when the survivor doesn't exist", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerOrg = {
        create: vi.fn(),
        findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
          where.id === "org-1" ? Promise.resolve({ id: "org-1", name: "X" }) : Promise.resolve(null),
        ),
        update: vi.fn(),
        delete: vi.fn(),
      };
      await expect(
        runManagePartnerOrg("u1", { action: "merge_into", orgId: "org-1", survivorOrgId: "missing" }),
      ).rejects.toMatchObject({ name: "McpNotFoundError" });
    });
  });
});
