import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/doc-search.server", () => ({ indexPageBody: vi.fn() }));
// Decoding real Y.Doc bytes is covered by the collab tests; here the sweep's
// job is choosing WHICH documents to decode, so the decode is stubbed.
vi.mock("~/collab/read", () => ({ stateToBlocks: vi.fn(() => ({ blocks: [], source: "blocknote" })) }));
vi.mock("~/components/doc/schema/configs", () => ({ blocksToPlainText: vi.fn(() => "body text") }));

import { prisma } from "~/lib/db";
import { indexPageBody } from "~/lib/doc-search.server";
import { runDocSearchIndex } from "~/jobs/doc-search-index.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockIndex = indexPageBody as unknown as ReturnType<typeof vi.fn>;

const ctx = (batchSize = 200) => ({
  now: new Date("2026-09-04T12:00:00Z"),
  lastSuccessAt: null,
  settings: { batchSize },
});

const OLD = new Date("2026-09-01T00:00:00Z");
const NEW = new Date("2026-09-03T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.page.findMany.mockResolvedValue([]);
  mockPrisma.collabDocument.findMany.mockResolvedValue([]);
  mockPrisma.pageSearchIndex.findMany.mockResolvedValue([]);
});

describe("runDocSearchIndex", () => {
  it("indexes a page that has never been indexed", async () => {
    mockPrisma.page.findMany.mockResolvedValue([{ id: "p1", contentDocId: null }]);
    mockPrisma.collabDocument.findMany
      .mockResolvedValueOnce([{ name: "doc:p1:body", updatedAt: NEW }])
      .mockResolvedValueOnce([{ name: "doc:p1:body", state: Buffer.from([1, 2]) }]);

    const result = await runDocSearchIndex(ctx());

    expect(result.items).toBe(1);
    expect(mockIndex).toHaveBeenCalledWith("p1", "body text", NEW);
  });

  it("skips a page whose index is already current", async () => {
    mockPrisma.page.findMany.mockResolvedValue([{ id: "p1", contentDocId: null }]);
    mockPrisma.collabDocument.findMany.mockResolvedValue([
      { name: "doc:p1:body", updatedAt: OLD },
    ]);
    mockPrisma.pageSearchIndex.findMany.mockResolvedValue([
      { pageId: "p1", sourceUpdatedAt: OLD },
    ]);

    const result = await runDocSearchIndex(ctx());

    expect(result).toEqual({ items: 0, note: "index up to date" });
    expect(mockIndex).not.toHaveBeenCalled();
  });

  it("re-indexes a page edited since it was last indexed", async () => {
    mockPrisma.page.findMany.mockResolvedValue([{ id: "p1", contentDocId: null }]);
    mockPrisma.collabDocument.findMany
      .mockResolvedValueOnce([{ name: "doc:p1:body", updatedAt: NEW }])
      .mockResolvedValueOnce([{ name: "doc:p1:body", state: Buffer.from([1]) }]);
    mockPrisma.pageSearchIndex.findMany.mockResolvedValue([
      { pageId: "p1", sourceUpdatedAt: OLD },
    ]);

    expect((await runDocSearchIndex(ctx())).items).toBe(1);
    expect(mockIndex).toHaveBeenCalledWith("p1", "body text", NEW);
  });

  it("resolves a seeded page through its contentDocId override", async () => {
    mockPrisma.page.findMany.mockResolvedValue([{ id: "p1", contentDocId: "legacy:room:name" }]);
    mockPrisma.collabDocument.findMany
      .mockResolvedValueOnce([{ name: "legacy:room:name", updatedAt: NEW }])
      .mockResolvedValueOnce([{ name: "legacy:room:name", state: Buffer.from([1]) }]);

    expect((await runDocSearchIndex(ctx())).items).toBe(1);
    expect(mockPrisma.collabDocument.findMany.mock.calls[0][0].where.name.in).toEqual([
      "legacy:room:name",
    ]);
    expect(mockIndex).toHaveBeenCalledWith("p1", "body text", NEW);
  });

  it("bounds a run to the batch size, oldest edit first, and reports the rest", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "p1", contentDocId: null },
      { id: "p2", contentDocId: null },
      { id: "p3", contentDocId: null },
    ]);
    mockPrisma.collabDocument.findMany
      .mockResolvedValueOnce([
        { name: "doc:p3:body", updatedAt: new Date("2026-09-03T00:00:00Z") },
        { name: "doc:p1:body", updatedAt: new Date("2026-09-01T00:00:00Z") },
        { name: "doc:p2:body", updatedAt: new Date("2026-09-02T00:00:00Z") },
      ])
      .mockResolvedValueOnce([
        { name: "doc:p1:body", state: Buffer.from([1]) },
        { name: "doc:p2:body", state: Buffer.from([2]) },
      ]);

    const result = await runDocSearchIndex(ctx(2));

    expect(result.items).toBe(2);
    expect(result.note).toContain("1 left for the next run");
    expect(mockIndex.mock.calls.map((c) => c[0])).toEqual(["p1", "p2"]);
  });

  it("keeps sweeping when one document fails to index", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      { id: "p1", contentDocId: null },
      { id: "p2", contentDocId: null },
    ]);
    mockPrisma.collabDocument.findMany
      .mockResolvedValueOnce([
        { name: "doc:p1:body", updatedAt: OLD },
        { name: "doc:p2:body", updatedAt: NEW },
      ])
      .mockResolvedValueOnce([
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

  it("does nothing when a page has no collab document yet", async () => {
    mockPrisma.page.findMany.mockResolvedValue([{ id: "p1", contentDocId: null }]);

    expect(await runDocSearchIndex(ctx())).toEqual({ items: 0, note: "index up to date" });
    expect(mockIndex).not.toHaveBeenCalled();
  });
});
