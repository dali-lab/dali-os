import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    domain: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isDomainLead: vi.fn(),
  isAdmin: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore, isDomainLead, isAdmin } from "~/lib/roles";
import { runListDomains, LIST_DOMAINS_TOOL } from "~/mcp/tools/admin/list-domains";

const mockPrisma = prisma as unknown as {
  domain: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

const DOMAIN = {
  id: "d1",
  name: "Design",
  code: "Design",
  displayName: "Design",
  domainLeadAssignments: [],
  _count: {
    challengeVersions: 2,
    applicationCycles: 1,
    domainLeadAssignments: 0,
    cycleReviewers: 3,
    cycleInterviewers: 3,
    delibsSessions: 1,
  },
};

describe("list_domains", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_DOMAINS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("throws McpForbiddenError when caller is none of isCore/isDomainLead/isAdmin", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isDomainLead).mockResolvedValue(false);
    vi.mocked(isAdmin).mockResolvedValue(false);

    await expect(runListDomains("u-nobody")).rejects.toMatchObject({
      name: "McpForbiddenError",
      status: 403,
    });
  });

  it("allows a Core lead", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isDomainLead).mockResolvedValue(false);
    vi.mocked(isAdmin).mockResolvedValue(false);
    mockPrisma.domain.findMany.mockResolvedValue([DOMAIN]);

    const out = await runListDomains("u-core");
    expect(out.domains).toHaveLength(1);
    expect(out.domains[0].id).toBe("d1");
  });

  it("allows a domain lead (not Core)", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isDomainLead).mockResolvedValue(true);
    vi.mocked(isAdmin).mockResolvedValue(false);
    mockPrisma.domain.findMany.mockResolvedValue([DOMAIN]);

    const out = await runListDomains("u-dl");
    expect(out.domains[0].id).toBe("d1");
  });

  it("allows an admin (not Core, not domain lead)", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isDomainLead).mockResolvedValue(false);
    vi.mocked(isAdmin).mockResolvedValue(true);
    mockPrisma.domain.findMany.mockResolvedValue([DOMAIN]);

    const out = await runListDomains("u-admin");
    expect(out.domains[0].id).toBe("d1");
  });

  it("returns domains with lead assignments and counts", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isDomainLead).mockResolvedValue(false);
    vi.mocked(isAdmin).mockResolvedValue(false);
    const domainWithLead = {
      ...DOMAIN,
      domainLeadAssignments: [
        { id: "dla1", userId: "u1", user: { id: "u1", firstName: "Alice", lastName: "Smith" } },
      ],
    };
    mockPrisma.domain.findMany.mockResolvedValue([domainWithLead]);

    const out = await runListDomains("u-core");
    expect(out.domains[0].domainLeadAssignments).toHaveLength(1);
    expect(out.domains[0]._count.challengeVersions).toBe(2);
    expect(out.domains[0]._count.cycleReviewers).toBe(3);
  });
});
