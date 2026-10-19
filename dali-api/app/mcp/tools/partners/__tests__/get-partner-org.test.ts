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
import { runGetPartnerOrg, GET_PARTNER_ORG_TOOL } from "../get-partner-org";

const mockPrisma = prisma as unknown as {
  partnerOrg: { findUnique: ReturnType<typeof vi.fn> };
  partnerInvite: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.partnerInvite = { findMany: vi.fn().mockResolvedValue([]) };
});

describe("get_partner_org", () => {
  it("requires mcp:read scope", () => {
    expect(GET_PARTNER_ORG_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects non-staffing callers", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(false);
    await expect(runGetPartnerOrg("u1", { orgId: "org-1" })).rejects.toMatchObject({
      name: "McpForbiddenError",
    });
  });

  it("404s on a missing org", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    mockPrisma.partnerOrg = { findUnique: vi.fn().mockResolvedValue(null) };
    await expect(runGetPartnerOrg("u1", { orgId: "missing" })).rejects.toMatchObject({
      name: "McpNotFoundError",
    });
  });

  it("returns the 360 shape with derived status", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    mockPrisma.partnerOrg = {
      findUnique: vi.fn().mockResolvedValue({
        id: "org-1",
        name: "Acme Corp",
        website: "https://acme.com",
        logoUrl: null,
        isIndividual: false,
        primaryContactId: "m1",
        createdAt: new Date("2025-01-01"),
        type: "Company",
        address: "1 Main St",
        legalEntityName: "Acme Corp LLC",
        tags: ["ai", "healthcare"],
        notes: "Good partner",
        showcaseConsent: true,
        referredByContactId: null,
        memberships: [
          {
            id: "m1",
            role: "CTO",
            contact: { id: "c1", name: "Jo", email: "jo@acme.com", title: "CTO", userId: null },
          },
        ],
        projects: [
          {
            id: "pp1",
            startedAt: new Date("2025-01-01"),
            endedAt: null,
            project: { id: "proj-1", name: "Kiosk", status: "Active" },
          },
        ],
        applications: [
          { id: "app-1", title: "Kiosk pitch", stage: "Accepted", createdAt: new Date(), nextStep: null },
        ],
        activities: [{ id: "a1", createdAt: new Date(), type: "Note", body: "hi", metadata: null }],
      }),
    };

    const out = (await runGetPartnerOrg("u1", { orgId: "org-1" })) as Record<string, unknown>;
    expect(out.status).toBe("Active");
    expect(out.type).toBe("Company");
    expect(out.tags).toEqual(["ai", "healthcare"]);
    expect(out.contacts).toMatchObject([
      { contactId: "c1", name: "Jo", isPrimaryContact: true },
    ]);
    expect(out.applications).toMatchObject([{ id: "app-1", stage: "Accepted" }]);
    expect(out.projects).toMatchObject([{ projectName: "Kiosk", active: true }]);
    expect(out.recentActivity).toMatchObject([{ id: "a1", type: "Note" }]);
  });
});
