import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, canViewStaffing: vi.fn() };
});
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
import { canViewStaffing } from "~/lib/roles";
import { runListPartnerOrgs, LIST_PARTNER_ORGS_TOOL } from "../list-partner-orgs";

const mockPrisma = prisma as unknown as {
  partnerOrg: { findMany: ReturnType<typeof vi.fn> };
  partnerApplication: { count: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_partner_orgs", () => {
  it("requires mcp:read scope", () => {
    expect(LIST_PARTNER_ORGS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects non-staffing callers", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(false);
    await expect(runListPartnerOrgs("u1", {})).rejects.toMatchObject({
      name: "McpForbiddenError",
    });
  });

  it("returns orgs list", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    mockPrisma.partnerOrg = {
      findMany: vi.fn().mockResolvedValue([]),
    };
    mockPrisma.partnerApplication = {
      count: vi.fn().mockResolvedValue(0),
    };
    const out = await runListPartnerOrgs("u1", {});
    expect(out).toMatchObject({ orgs: [], openInquiryCount: 0 });
  });

  it("computes activeProjectCount and openInquiryCount correctly", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    const now = new Date();
    const past = new Date(now.getTime() - 1000);
    const future = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);

    mockPrisma.partnerOrg = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "org-1",
          name: "Acme Corp",
          website: "https://acme.com",
          isIndividual: false,
          // Active memberships (account-first), not the retired `users` relation.
          memberships: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
          projects: [
            // active (no dates)
            { startedAt: null, endedAt: null, project: { status: "Active" } },
            // active (past start, future end)
            { startedAt: past, endedAt: future, project: { status: "Active" } },
            // ended
            { startedAt: past, endedAt: past, project: { status: "Active" } },
            // archived
            { startedAt: null, endedAt: null, project: { status: "Archived" } },
          ],
        },
      ]),
    };
    // Open inquiries are counted lab-wide (org-independent until promotion).
    mockPrisma.partnerApplication = {
      count: vi.fn().mockResolvedValue(2),
    };

    const out = await runListPartnerOrgs("u1", {});
    const org = (out.orgs as Array<Record<string, unknown>>)[0];
    expect(org.memberCount).toBe(3);
    expect(org.activeProjectCount).toBe(2);
    expect(org.openApplicationCount).toBeUndefined();
    expect(out.openInquiryCount).toBe(2);
  });
});
