import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
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
  return { McpError, McpForbiddenError, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});

import { prisma } from "~/lib/db.server";
import { canViewStaffing } from "~/lib/roles";
import { runListPartnerContacts, LIST_PARTNER_CONTACTS_TOOL } from "../list-partner-contacts";

const mockPrisma = prisma as unknown as {
  partnerContact: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_partner_contacts", () => {
  it("requires mcp:read scope", () => {
    expect(LIST_PARTNER_CONTACTS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("rejects non-staffing callers", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(false);
    await expect(runListPartnerContacts("u1", {})).rejects.toMatchObject({
      name: "McpForbiddenError",
    });
  });

  it("shapes contacts with org names and application counts", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    mockPrisma.partnerContact = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "c1",
          name: "Jo",
          email: "jo@acme.com",
          title: "CTO",
          phone: null,
          affiliation: null,
          preferredChannel: "Email",
          memberships: [{ org: { id: "org-1", name: "Acme" } }],
          _count: { applications: 2 },
        },
      ]),
    };

    const out = (await runListPartnerContacts("u1", { search: "jo" })) as {
      contacts: Record<string, unknown>[];
    };
    expect(out.contacts).toMatchObject([
      { id: "c1", name: "Jo", orgs: [{ id: "org-1", name: "Acme" }], applicationCount: 2 },
    ]);
    expect(mockPrisma.partnerContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { name: { contains: "jo", mode: "insensitive" } },
            { email: { contains: "jo", mode: "insensitive" } },
          ],
        }),
      }),
    );
  });

  it("scopes to one org's active members when orgId is given", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    mockPrisma.partnerContact = { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) };
    await runListPartnerContacts("u1", { orgId: "org-1" });
    expect(mockPrisma.partnerContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memberships: { some: { orgId: "org-1", endedAt: null } },
        }),
      }),
    );
  });

  it("walks pages by offset with an id tiebreak and ends with a null cursor", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    const row = (id: string) => ({
      id, name: "Jo", email: null, title: null, phone: null, affiliation: null,
      preferredChannel: "Email", memberships: [], _count: { applications: 0 },
    });
    const findMany = vi.fn().mockResolvedValueOnce([row("c1"), row("c2"), row("c3")]);
    mockPrisma.partnerContact = { findMany, count: vi.fn().mockResolvedValue(3) };

    const first = (await runListPartnerContacts("u1", { limit: 2 })) as {
      contacts: { id: string }[];
      page: { nextCursor: string | null; hasMore: boolean; total: number };
    };
    expect(first.contacts.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2, total: 3 });
    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: 0,
      take: 3,
    });

    findMany.mockResolvedValueOnce([row("c3")]);
    const second = (await runListPartnerContacts("u1", { limit: 2, cursor: first.page.nextCursor! })) as typeof first;
    expect(second.contacts.map((c) => c.id)).toEqual(["c3"]);
    expect(second.page.nextCursor).toBeNull();
    expect(findMany.mock.calls[1][0]).toMatchObject({ skip: 2 });
  });

  it("counts with the same filters as the page", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(true);
    const count = vi.fn().mockResolvedValue(0);
    mockPrisma.partnerContact = { findMany: vi.fn().mockResolvedValue([]), count };
    await runListPartnerContacts("u1", { orgId: "org-1" });
    expect(count).toHaveBeenCalledWith({
      where: { memberships: { some: { orgId: "org-1", endedAt: null } } },
    });
  });
});
