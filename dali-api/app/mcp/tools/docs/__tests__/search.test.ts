import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock db so the real ~/lib/roles pulled in via orig() below doesn't load the
// generated Prisma client (absent in CI). Uses the manual mock in __mocks__/db.
vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, getUserRoles: vi.fn() };
});
vi.mock("~/lib/search.server", () => ({
  runSearchWithOverflow: vi.fn(),
  runCategorySearch: vi.fn(),
}));

import { getUserRoles } from "~/lib/roles";
import { runCategorySearch, runSearchWithOverflow } from "~/lib/search.server";
import { SEARCH_TOOL, runMcpSearch } from "~/mcp/tools/docs/search";

const MEMBER = { isLabMember: true, isCore: false, isDomainLead: false, canViewForms: false, canViewStaffing: false };
const result = (id: string) => ({ type: "person", id, title: id, url: `/members/${id}` }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserRoles).mockResolvedValue(MEMBER as never);
});

describe("search", () => {
  it("requires the mcp:read scope", () => {
    expect(SEARCH_TOOL.requiredScope).toBe("mcp:read");
  });

  it("describes 5 per category rather than about 40", () => {
    expect(SEARCH_TOOL.description).toContain("5 best matches per category");
    expect(SEARCH_TOOL.description).not.toContain("40");
  });

  it("returns empty results for non-lab-member (runSearch gates internally)", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({ ...MEMBER, isLabMember: false } as never);
    vi.mocked(runSearchWithOverflow).mockResolvedValue({ results: [], categoriesWithMore: [] });

    const out = await runMcpSearch("u1", { q: "test" });
    expect(out.results).toEqual([]);
    expect(runSearchWithOverflow).toHaveBeenCalledWith({ userId: "u1", roles: expect.any(Object), q: "test" });
  });

  it("without a category returns the top results and names the categories that had more", async () => {
    vi.mocked(runSearchWithOverflow).mockResolvedValue({ results: [result("p1")], categoriesWithMore: ["person"] });

    const out = await runMcpSearch("u1", { q: "alpha" });

    expect(out).toEqual({ results: [expect.objectContaining({ id: "p1" })], categoriesWithMore: ["person"] });
    expect(runCategorySearch).not.toHaveBeenCalled();
  });

  it("rejects a cursor without a category", async () => {
    await expect(runMcpSearch("u1", { q: "alpha", cursor: "x" })).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("rejects an unknown category", async () => {
    await expect(runMcpSearch("u1", { q: "alpha", category: "nope" as never })).rejects.toMatchObject({
      name: "McpInvalidError",
    });
  });

  it("offers every searchable category in the schema", () => {
    const category = SEARCH_TOOL.inputSchema.properties.category as { enum: string[] };
    expect(category.enum).toEqual(expect.arrayContaining(["person", "document", "partnerApplication", "helpArticle"]));
    expect(category.enum).not.toContain("challenge");
  });

  it("pages one category: asks for limit+1 at the offset and ends with no cursor", async () => {
    vi.mocked(runCategorySearch).mockResolvedValueOnce([result("a"), result("b"), result("c")]);
    const first = await runMcpSearch("u1", { q: "ada", category: "person", limit: 2 });

    expect(runCategorySearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: "person", q: "ada", skip: 0, limit: 2 }),
    );
    expect(first.results.map((r) => r.id)).toEqual(["a", "b"]);
    const page = (first as { page: { nextCursor: string; hasMore: boolean } }).page;
    expect(page.hasMore).toBe(true);

    vi.mocked(runCategorySearch).mockResolvedValueOnce([result("c")]);
    const second = await runMcpSearch("u1", { q: "ada", category: "person", limit: 2, cursor: page.nextCursor });
    expect(runCategorySearch).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 2, limit: 2 }));
    expect(second.results.map((r) => r.id)).toEqual(["c"]);
    expect((second as { page: unknown }).page).toMatchObject({ nextCursor: null, hasMore: false });
  });
});
