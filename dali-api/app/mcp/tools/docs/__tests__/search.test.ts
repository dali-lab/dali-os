import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock db so the real ~/lib/roles pulled in via orig() below doesn't load the
// generated Prisma client (absent in CI). Uses the manual mock in __mocks__/db.
vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, getUserRoles: vi.fn() };
});
vi.mock("~/lib/search.server", () => ({
  runSearch: vi.fn(),
}));

import { getUserRoles } from "~/lib/roles";
import { runSearch } from "~/lib/search.server";
import { SEARCH_TOOL, runMcpSearch } from "~/mcp/tools/docs/search";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("search", () => {
  it("requires the mcp:read scope", () => {
    expect(SEARCH_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns empty results for non-lab-member (runSearch gates internally)", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({
      isLabMember: false,
      isCore: false,
      isDomainLead: false,
      canViewForms: false,
      canViewStaffing: false,
    } as ReturnType<typeof getUserRoles> extends Promise<infer T> ? T : never);
    vi.mocked(runSearch).mockResolvedValue([]);

    const out = await runMcpSearch("u1", { q: "test" });
    expect(out.results).toEqual([]);
    expect(runSearch).toHaveBeenCalledWith({ userId: "u1", roles: expect.any(Object), q: "test" });
  });

  it("returns search results for a lab member", async () => {
    const mockRoles = { isLabMember: true, isCore: false, isDomainLead: false, canViewForms: false, canViewStaffing: false };
    vi.mocked(getUserRoles).mockResolvedValue(mockRoles as never);
    vi.mocked(runSearch).mockResolvedValue([
      { type: "project", id: "p1", title: "Alpha", subtitle: "Project", url: "/projects/p1" } as never,
    ]);

    const out = await runMcpSearch("u1", { q: "alpha" });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ id: "p1", title: "Alpha" });
  });
});
