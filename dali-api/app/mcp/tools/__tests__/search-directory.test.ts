import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  runSearchDirectory,
  SEARCH_DIRECTORY_TOOL,
} from "~/mcp/tools/search-directory";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";

const mockPrisma = prisma as unknown as {
  user: { findMany: ReturnType<typeof vi.fn> };
  term: { findFirst: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.term.findFirst.mockResolvedValue({ id: "term-1", code: "26S" });
});

describe("search_directory", () => {
  it("requires mcp:read", () => {
    expect(SEARCH_DIRECTORY_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns directory rows with computed tier + domains", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: "u1",
        firstName: "Ada",
        lastName: "Lovelace",
        daliEmail: "ada@dali.dartmouth.edu",
        netId: "f001abc",
        adminMembership: null,
        coreAssignments: [{ leadTitle: "Hiring Lead" }],
        domainLeadAssignmentsAsUser: [],
        domainEligibilities: [{ domain: { displayName: "Fullstack Dev" } }],
      },
    ]);

    const out = await runSearchDirectory({ query: "ada" });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({
      id: "u1",
      tier: "core",
      domains: ["Fullstack Dev"],
      currentTermRoles: ["Hiring Lead"],
    });
  });

  it("rejects empty query at the schema layer", () => {
    const r = validateInput(
      { query: "" },
      SEARCH_DIRECTORY_TOOL.inputSchema as JsonSchema,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects query > 100 chars at the schema layer", () => {
    const r = validateInput(
      { query: "x".repeat(101) },
      SEARCH_DIRECTORY_TOOL.inputSchema as JsonSchema,
    );
    expect(r.ok).toBe(false);
  });

  it("returns empty results when no rows match", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    const out = await runSearchDirectory({ query: "noone" });
    expect(out.results).toEqual([]);
  });

  it("scopes to current-term members by default (member set + privacy)", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await runSearchDirectory({ query: "x" });
    const call = mockPrisma.user.findMany.mock.calls[0][0];
    // Member predicate is AND-ed with the search OR; the member half stays
    // scoped to DALIMember rows and, by default, current-term-active ones.
    expect(call.where.AND[0].daliMember).toEqual({ isNot: null });
    expect(call.where.AND[0].OR).toBeDefined();
  });

  it("drops the current-term filter when includeInactive is set", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await runSearchDirectory({ query: "x", includeInactive: true });
    const call = mockPrisma.user.findMany.mock.calls[0][0];
    expect(call.where.AND[0]).toEqual({ daliMember: { isNot: null } });
  });

  it("does not expose netId in bulk directory rows", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: "u1",
        firstName: "Ada",
        lastName: "Lovelace",
        daliEmail: "ada@dali.dartmouth.edu",
        adminMembership: null,
        coreAssignments: [],
        domainLeadAssignmentsAsUser: [],
        domainEligibilities: [],
      },
    ]);
    const out = await runSearchDirectory({ query: "ada" });
    expect(out.results[0]).not.toHaveProperty("netId");
  });
});
