import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
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
import { runManagePartnerContact, MANAGE_PARTNER_CONTACT_TOOL } from "../manage-partner-contact";

const mockPrisma = prisma as unknown as {
  partnerContact: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_partner_contact", () => {
  it("requires mcp:write scope", () => {
    expect(MANAGE_PARTNER_CONTACT_TOOL.requiredScope).toBe("mcp:write");
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManagePartnerContact("u1", { action: "create", name: "Jo", email: "jo@acme.com" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  describe("create", () => {
    it("creates a new contact", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerContact = {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "c1", name: "Jo" }),
        update: vi.fn(),
      };
      const out = await runManagePartnerContact("u1", {
        action: "create",
        name: "Jo",
        email: "Jo@Acme.com",
      });
      expect(out).toMatchObject({ id: "c1", name: "Jo", linkedExisting: false });
      expect(mockPrisma.partnerContact.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: "jo@acme.com" }) }),
      );
    });

    it("links to the existing contact instead of duplicating", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerContact = {
        findUnique: vi.fn().mockResolvedValue({ id: "c-existing", name: "Jo Existing" }),
        create: vi.fn(),
        update: vi.fn(),
      };
      const out = await runManagePartnerContact("u1", {
        action: "create",
        name: "Jo",
        email: "jo@acme.com",
      });
      expect(out).toMatchObject({ id: "c-existing", linkedExisting: true });
      expect(mockPrisma.partnerContact.create).not.toHaveBeenCalled();
    });

    it("rejects an invalid preferredChannel", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      await expect(
        runManagePartnerContact("u1", {
          action: "create",
          name: "Jo",
          email: "jo@acme.com",
          preferredChannel: "Carrier pigeon",
        }),
      ).rejects.toMatchObject({ name: "McpInvalidError" });
    });
  });

  describe("update", () => {
    it("404s on a missing contact", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerContact = {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
      };
      await expect(
        runManagePartnerContact("u1", { action: "update", contactId: "missing", title: "VP" }),
      ).rejects.toMatchObject({ name: "McpNotFoundError" });
    });

    it("updates only the given fields", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerContact = {
        findUnique: vi.fn().mockResolvedValue({ id: "c1" }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      };
      const out = await runManagePartnerContact("u1", {
        action: "update",
        contactId: "c1",
        title: "VP Engineering",
      });
      expect(out).toMatchObject({ ok: true });
      expect(mockPrisma.partnerContact.update).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: { title: "VP Engineering" },
      });
    });

    it("surfaces a P2002 email collision as McpInvalidError", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.partnerContact = {
        findUnique: vi.fn().mockResolvedValue({ id: "c1" }),
        create: vi.fn(),
        update: vi.fn().mockRejectedValue({ code: "P2002" }),
      };
      await expect(
        runManagePartnerContact("u1", { action: "update", contactId: "c1", email: "taken@acme.com" }),
      ).rejects.toMatchObject({ name: "McpInvalidError" });
    });
  });
});
