import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { searchDirectory } from "../directory-search.server";

const mockPrisma = prisma as unknown as {
  user: { findMany: ReturnType<typeof vi.fn> };
  term: { findFirst: ReturnType<typeof vi.fn> };
};

const user = (over: Record<string, unknown> = {}) => ({
  id: "u1",
  firstName: "Ada",
  lastName: "Lovelace",
  daliEmail: "ada@example.edu",
  adminMembership: null,
  coreAssignments: [],
  domainLeadAssignmentsAsUser: [{ domain: { displayName: "Design" } }],
  domainEligibilities: [{ domain: { displayName: "Design" } }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.term.findFirst.mockResolvedValue({ id: "term-1", code: "26F" });
  mockPrisma.user.findMany.mockResolvedValue([user()]);
});

describe("searchDirectory", () => {
  it("returns rows with tier, domains and roles", async () => {
    expect(await searchDirectory({ query: "ada", take: 15 })).toEqual([
      {
        id: "u1",
        firstName: "Ada",
        lastName: "Lovelace",
        daliEmail: "ada@example.edu",
        tier: "domain-lead",
        domains: ["Design"],
        currentTermRoles: ["Design Lead"],
      },
    ]);
  });

  it("passes skip and take straight to the query", async () => {
    await searchDirectory({ query: "ada", skip: 20, take: 21 });
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 21 }));
  });

  it("does not query for a blank search", async () => {
    expect(await searchDirectory({ query: "   ", take: 15 })).toEqual([]);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });
});
