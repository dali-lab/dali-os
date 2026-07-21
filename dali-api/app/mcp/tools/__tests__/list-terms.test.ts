import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, currentTerm: vi.fn() };
});

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { runListTerms, LIST_TERMS_TOOL } from "~/mcp/tools/list-terms";

const mockPrisma = prisma as unknown as {
  term: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("list_terms", () => {
  it("scope is read", () => {
    expect(LIST_TERMS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("returns chronological terms with the current one flagged", async () => {
    mockPrisma.term.findMany.mockResolvedValue([
      {
        id: "t-26s",
        code: "26S",
        year: 2026,
        season: "Spring",
        startDate: new Date("2026-03-30T00:00:00Z"),
        endDate: new Date("2026-06-10T00:00:00Z"),
      },
      {
        id: "t-26x",
        code: "26X",
        year: 2026,
        season: "Summer",
        startDate: new Date("2026-06-25T00:00:00Z"),
        endDate: new Date("2026-08-30T00:00:00Z"),
      },
    ]);
    vi.mocked(currentTerm).mockResolvedValue({ id: "t-26x" } as never);

    const out = await runListTerms();
    expect(out.terms.map((t) => [t.code, t.isCurrent])).toEqual([
      ["26S", false],
      ["26X", true],
    ]);
    expect(out.terms[1]).toMatchObject({
      id: "t-26x",
      year: 2026,
      season: "Summer",
      startsAt: "2026-06-25T00:00:00.000Z",
    });
    expect(mockPrisma.term.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { sortKey: "asc" } }),
    );
  });

  it("no current term (empty table) → nothing flagged", async () => {
    mockPrisma.term.findMany.mockResolvedValue([]);
    vi.mocked(currentTerm).mockResolvedValue(null as never);
    const out = await runListTerms();
    expect(out.terms).toEqual([]);
  });
});
