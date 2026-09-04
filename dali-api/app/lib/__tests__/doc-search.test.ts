import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  INDEX_MAX_CHARS,
  indexPageBody,
  normalizeIndexText,
  searchPageContent,
} from "~/lib/doc-search.server";

const mockPrisma = prisma as unknown as {
  pageSearchIndex: { deleteMany: ReturnType<typeof vi.fn> };
  $executeRaw: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.pageSearchIndex.deleteMany.mockResolvedValue({ count: 0 });
  // The fuzzy pass runs inside an interactive transaction; hand the callback a
  // tx that behaves like the client so the pass can be exercised.
  mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({ $executeRawUnsafe: vi.fn(), $queryRaw: mockPrisma.$queryRaw }),
  );
});

describe("normalizeIndexText", () => {
  it("flattens horizontal whitespace but keeps block breaks", () => {
    expect(normalizeIndexText("a   b\t\tc\nd")).toBe("a b c\nd");
  });

  it("caps runs of blank lines", () => {
    expect(normalizeIndexText("first\n\n\n\n\nsecond")).toBe("first\n\nsecond");
  });

  it("truncates to the index ceiling", () => {
    expect(normalizeIndexText("x".repeat(INDEX_MAX_CHARS + 500))).toHaveLength(INDEX_MAX_CHARS);
  });

  it("reduces a whitespace-only body to nothing", () => {
    expect(normalizeIndexText("   \n\n \t ")).toBe("");
  });
});

describe("indexPageBody", () => {
  it("writes the text and its lexeme vector in one statement", async () => {
    await indexPageBody("p1", "Onboarding flow notes", new Date("2026-09-01T00:00:00Z"));

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...params] = mockPrisma.$executeRaw.mock.calls[0];
    expect(strings.join("?")).toContain("to_tsvector('english',");
    expect(params).toContain("p1");
    expect(params).toContain("Onboarding flow notes");
  });

  it("drops the row when a page's body is emptied, rather than storing blank text", async () => {
    await indexPageBody("p1", "   \n  ", new Date());

    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockPrisma.pageSearchIndex.deleteMany).toHaveBeenCalledWith({
      where: { pageId: "p1" },
    });
  });
});

describe("searchPageContent", () => {
  it("does not query at all for an empty query", async () => {
    expect(await searchPageContent("   ", 5)).toEqual([]);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("skips the fuzzy pass when the exact pass already fills the page", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: "p1", title: "One", iconEmoji: null, snippet: "a" },
      { id: "p2", title: "Two", iconEmoji: null, snippet: "b" },
    ]);

    const hits = await searchPageContent("onboarding", 2);

    expect(hits.map((h) => h.pageId)).toEqual(["p1", "p2"]);
    expect(hits.every((h) => !h.fuzzy)).toBe(true);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("falls back to the fuzzy pass when the exact pass comes up short", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "p9", title: "Onboarding", iconEmoji: "📗", snippet: "text" }]);

    const hits = await searchPageContent("onbaording", 5);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(hits).toEqual([
      { pageId: "p9", title: "Onboarding", iconEmoji: "📗", snippet: "text", fuzzy: true },
    ]);
  });

  it("does not fuzzy-match a query too short for trigrams to mean anything", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);

    expect(await searchPageContent("ret", 5)).toEqual([]);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps the exact hit when both passes return the same page", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ id: "p1", title: "Retro", iconEmoji: null, snippet: "exact" }])
      .mockResolvedValueOnce([
        { id: "p1", title: "Retro", iconEmoji: null, snippet: "fuzzy" },
        { id: "p2", title: "Other", iconEmoji: null, snippet: "fuzzy" },
      ]);

    const hits = await searchPageContent("retrospective", 5);

    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ pageId: "p1", snippet: "exact", fuzzy: false });
    expect(hits[1]).toMatchObject({ pageId: "p2", fuzzy: true });
  });

  it("folds a multi-line snippet onto one line for the palette", async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: "p1", title: "Notes", iconEmoji: null, snippet: "  first line\n\nsecond   line " },
    ]);

    const [hit] = await searchPageContent("line", 5);

    expect(hit.snippet).toBe("first line second line");
  });
});
