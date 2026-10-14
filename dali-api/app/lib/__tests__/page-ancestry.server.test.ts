import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { $queryRawUnsafe: vi.fn() } }));

import { prisma } from "~/lib/db";
import {
  loadAncestorChain,
  loadAncestorChains,
  chainDepth,
  chainHasAncestor,
  chainGoverningScope,
  type ChainRow,
} from "~/lib/page-ancestry.server";
import { pageDepth, isAncestorOf, MAX_PAGE_DEPTH } from "~/lib/pages";

const m = prisma as any;

const row = (id: string, parentPageId: string | null, over: Partial<ChainRow> = {}): ChainRow => ({
  id,
  title: id,
  parentPageId,
  scopeKind: null,
  scopeGroupId: null,
  scopePermission: null,
  createdById: null,
  workspaceType: "Lab",
  workspaceId: null,
  kind: "Folder",
  archivedAt: null,
  ...over,
});

// Nearest first, the way loadAncestorChain returns it: n0 -> n1 -> ... -> n(len-1) (root).
const chainOf = (length: number, over: Record<number, Partial<ChainRow>> = {}) =>
  Array.from({ length }, (_, i) => row(`n${i}`, i === length - 1 ? null : `n${i + 1}`, over[i]));

describe("loadAncestorChain", () => {
  beforeEach(() => vi.resetAllMocks());

  it("asks for the page and its ancestors in a single query", async () => {
    m.$queryRawUnsafe.mockResolvedValue([row("a", null)]);
    const chain = await loadAncestorChain("a");
    expect(m.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(m.$queryRawUnsafe.mock.calls[0][0]).toContain("WITH RECURSIVE");
    expect(m.$queryRawUnsafe.mock.calls[0][1]).toBe("a");
    expect(chain.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("loadAncestorChains", () => {
  beforeEach(() => vi.resetAllMocks());

  const tagged = (startId: string, r: ChainRow) => ({ startId, ...r });

  it("asks for every page and its ancestors in a single parameterised query", async () => {
    m.$queryRawUnsafe.mockResolvedValue([]);
    await loadAncestorChains(["a", "b", "c"]);
    expect(m.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, ids] = m.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("WITH RECURSIVE");
    expect(sql).toContain("ANY($1::text[])");
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("sends each distinct id once", async () => {
    m.$queryRawUnsafe.mockResolvedValue([]);
    await loadAncestorChains(["a", "b", "a"]);
    expect(m.$queryRawUnsafe.mock.calls[0][1]).toEqual(["a", "b"]);
  });

  it("does not query for no ids", async () => {
    expect(await loadAncestorChains([])).toEqual(new Map());
    expect(m.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("groups rows by the page the walk started from, nearest first", async () => {
    m.$queryRawUnsafe.mockResolvedValue([
      tagged("a", row("a", "p")),
      tagged("a", row("p", null)),
      tagged("b", row("b", "p")),
      tagged("b", row("p", null)),
    ]);
    const chains = await loadAncestorChains(["a", "b"]);
    expect([...chains.keys()]).toEqual(["a", "b"]);
    expect(chains.get("a")!.map((r) => r.id)).toEqual(["a", "p"]);
    expect(chains.get("b")!.map((r) => r.id)).toEqual(["b", "p"]);
  });

  it("leaves the start tag off the rows", async () => {
    m.$queryRawUnsafe.mockResolvedValue([tagged("a", row("a", null))]);
    expect((await loadAncestorChains(["a"])).get("a")![0]).not.toHaveProperty("startId");
  });

  it("has no entry for a page that does not exist", async () => {
    m.$queryRawUnsafe.mockResolvedValue([tagged("a", row("a", null))]);
    expect((await loadAncestorChains(["a", "gone"])).has("gone")).toBe(false);
  });

  it("caps chain length at the default row cap, or the one given", async () => {
    m.$queryRawUnsafe.mockResolvedValue([]);
    await loadAncestorChains(["a"]);
    expect(m.$queryRawUnsafe.mock.calls[0][0]).toContain(`< ${MAX_PAGE_DEPTH + 3}`);
    await loadAncestorChains(["a"], 20);
    expect(m.$queryRawUnsafe.mock.calls[1][0]).toContain("< 20");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects a row cap of %s", async (cap) => {
    await expect(loadAncestorChains(["a"], cap)).rejects.toThrow();
    expect(m.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe("chainDepth", () => {
  it("is the number of ancestors above the first row", () => {
    expect(chainDepth(chainOf(1))).toBe(0);
    expect(chainDepth(chainOf(4))).toBe(3);
  });

  it("is -1 for an empty chain (the page does not exist)", () => {
    expect(chainDepth([])).toBe(-1);
  });

  it("is -1 when an ancestor row is missing", () => {
    expect(chainDepth([row("n0", "n1"), row("n1", "gone")])).toBe(-1);
  });

  it("allows a chain of MAX_PAGE_DEPTH + 2 rows and refuses a longer one", () => {
    expect(chainDepth(chainOf(MAX_PAGE_DEPTH + 2))).toBe(MAX_PAGE_DEPTH + 1);
    expect(chainDepth(chainOf(MAX_PAGE_DEPTH + 3))).toBe(-1);
  });

  it("is -1 for cyclic data", () => {
    expect(chainDepth([row("a", "b"), row("b", "a"), row("a", "b")])).toBe(-1);
  });
});

describe("chainHasAncestor", () => {
  it("finds an ancestor anywhere up the chain", () => {
    const chain = chainOf(5);
    expect(chainHasAncestor(chain, "n1")).toBe(true);
    expect(chainHasAncestor(chain, "n4")).toBe(true);
  });

  it("does not count the first row itself", () => {
    expect(chainHasAncestor(chainOf(3), "n0")).toBe(false);
  });

  it("is false for an unrelated page or an empty chain", () => {
    expect(chainHasAncestor(chainOf(3), "elsewhere")).toBe(false);
    expect(chainHasAncestor([], "n1")).toBe(false);
  });

  it("matches a parent id even when that ancestor's own row is missing", () => {
    expect(chainHasAncestor([row("n0", "gone")], "gone")).toBe(true);
  });
});

describe("chainGoverningScope", () => {
  it("is the first row carrying a scope, starting with the parent itself", () => {
    const chain = chainOf(5, { 0: { scopeKind: "Lab" }, 2: { scopeKind: "Group" } });
    expect(chainGoverningScope(chain)?.id).toBe("n0");
  });

  it("is the nearest scoped ancestor when the parent has none", () => {
    const chain = chainOf(5, { 2: { scopeKind: "Group" }, 3: { scopeKind: "Private" } });
    expect(chainGoverningScope(chain)?.id).toBe("n2");
  });

  it("is null when nothing in the chain is scoped", () => {
    expect(chainGoverningScope(chainOf(4))).toBeNull();
    expect(chainGoverningScope([])).toBeNull();
  });

  it("ignores a scope past the 8-row walk bound", () => {
    expect(chainGoverningScope(chainOf(10, { 8: { scopeKind: "Group" } }))).toBeNull();
    expect(chainGoverningScope(chainOf(10, { 7: { scopeKind: "Group" } }))?.id).toBe("n7");
  });
});

// The chain helpers replace the per-level walks in pages.ts; both must agree
// on every shape of chain, including the broken and runaway ones.
describe("agreement with the per-level walks", () => {
  const shapes: Record<string, ChainRow[]> = {
    root: chainOf(1),
    shallow: chainOf(3),
    "at the depth limit": chainOf(MAX_PAGE_DEPTH + 2),
    "past the depth limit": chainOf(MAX_PAGE_DEPTH + 3),
    "missing ancestor": [row("n0", "n1"), row("n1", "gone")],
    cyclic: [row("n0", "n1"), row("n1", "n0")],
  };

  // Serve findUnique from a table; a cyclic table is served in full for every id.
  function serve(chain: ChainRow[]) {
    const byId = new Map(chain.map((r) => [r.id, r]));
    m.page = { findUnique: vi.fn(async ({ where }: any) => byId.get(where.id) ?? null) };
  }

  it.each(Object.entries(shapes))("%s", async (_name, chain) => {
    serve(chain);
    const walked = {
      depth: await pageDepth("n0"),
      ancestors: await Promise.all(["n0", "n1", "n3", "n8", "gone"].map((id) => isAncestorOf(id, "n0"))),
    };
    // A cyclic or over-long chain is loaded by the CTE up to its row cap.
    const loaded = loadedChain(chain);
    expect(chainDepth(loaded)).toBe(walked.depth);
    expect(["n0", "n1", "n3", "n8", "gone"].map((id) => chainHasAncestor(loaded, id))).toEqual(walked.ancestors);
  });

  function loadedChain(chain: ChainRow[]): ChainRow[] {
    const byId = new Map(chain.map((r) => [r.id, r]));
    const out: ChainRow[] = [];
    let next: string | null = chain[0].id;
    while (next !== null && out.length < MAX_PAGE_DEPTH + 3) {
      const found: ChainRow | undefined = byId.get(next);
      if (!found) break;
      out.push(found);
      next = found.parentPageId;
    }
    return out;
  }
});
