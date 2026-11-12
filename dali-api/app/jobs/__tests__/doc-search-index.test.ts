import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/doc-search.server", () => ({ indexPageBody: vi.fn() }));
vi.mock("~/collab/read", () => ({ stateToBlocks: vi.fn(() => ({ blocks: [], source: "blocknote" })) }));
vi.mock("~/components/doc/schema/configs", () => ({ blocksToPlainText: vi.fn(() => "body text") }));

import { prisma } from "~/lib/db.server";
import { indexPageBody } from "~/lib/doc-search.server";
import { runDocSearchIndex } from "~/jobs/doc-search-index.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>> & ReturnType<typeof vi.fn>
>;
const mockIndex = indexPageBody as unknown as ReturnType<typeof vi.fn>;
const queryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;

const ctx = (batchSize = 200) => ({
  now: new Date("2026-09-04T12:00:00Z"),
  lastSuccessAt: null,
  settings: { batchSize },
});

const OLD = new Date("2026-09-01T00:00:00Z");
const NEW = new Date("2026-09-03T00:00:00Z");

const row = (pageId: string, updatedAt: Date, total = 1) => ({
  pageId,
  name: `doc:${pageId}:body`,
  updatedAt,
  total: BigInt(total),
});

beforeEach(() => {
  vi.clearAllMocks();
  queryRaw.mockResolvedValue([]);
  mockPrisma.collabDocument.findMany.mockResolvedValue([]);
});

describe("runDocSearchIndex", () => {
  it("indexes the stale pages the query returns", async () => {
    queryRaw.mockResolvedValue([row("p1", NEW)]);
    mockPrisma.collabDocument.findMany.mockResolvedValue([
      { name: "doc:p1:body", state: Buffer.from([1, 2]) },
    ]);

    const result = await runDocSearchIndex(ctx());

    expect(result.items).toBe(1);
    expect(mockIndex).toHaveBeenCalledWith("p1", "body text", NEW);
  });

  it("does no state reads when nothing is stale", async () => {
    expect(await runDocSearchIndex(ctx())).toEqual({ items: 0, note: "index up to date" });
    expect(mockPrisma.collabDocument.findMany).not.toHaveBeenCalled();
    expect(mockIndex).not.toHaveBeenCalled();
  });

  it("fetches states for only the returned batch", async () => {
    queryRaw.mockResolvedValue([row("p1", OLD, 3), row("p2", NEW, 3)]);
    mockPrisma.collabDocument.findMany.mockResolvedValue([
      { name: "doc:p1:body", state: Buffer.from([1]) },
      { name: "doc:p2:body", state: Buffer.from([2]) },
    ]);

    const result = await runDocSearchIndex(ctx(2));

    expect(mockPrisma.collabDocument.findMany.mock.calls[0][0].where.name.in).toEqual([
      "doc:p1:body",
      "doc:p2:body",
    ]);
    expect(result.items).toBe(2);
    expect(result.note).toContain("1 left for the next run");
    expect(mockIndex.mock.calls.map((c) => c[0])).toEqual(["p1", "p2"]);
  });

  it("keeps sweeping when one document fails to index", async () => {
    queryRaw.mockResolvedValue([row("p1", OLD, 2), row("p2", NEW, 2)]);
    mockPrisma.collabDocument.findMany.mockResolvedValue([
      { name: "doc:p1:body", state: Buffer.from([1]) },
      { name: "doc:p2:body", state: Buffer.from([2]) },
    ]);
    mockIndex.mockRejectedValueOnce(new Error("undecodable"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runDocSearchIndex(ctx());

    expect(result.items).toBe(1);
    expect(result.note).toContain("1 failed");
    expect(mockIndex).toHaveBeenCalledTimes(2);
  });

  it("skips a row whose state is gone", async () => {
    queryRaw.mockResolvedValue([row("p1", NEW)]);
    expect((await runDocSearchIndex(ctx())).items).toBe(0);
    expect(mockIndex).not.toHaveBeenCalled();
  });
});
