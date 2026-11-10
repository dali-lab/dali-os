import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { INDEX_MAX_CHARS, indexPageBody, searchPageContent } from "~/lib/doc-search.server";
import { makePage, makeUser } from "./integration-fixtures.docs";

async function indexed(title: string, body: string, over: { archivedAt?: Date } = {}) {
  const user = await prisma.user.findFirst() ?? (await makeUser());
  const page = await makePage(user.id, { title, ...over });
  await indexPageBody(page.id, body, new Date());
  return page;
}

describe("indexPageBody", () => {
  it("writes a searchable row and refreshes it in place on re-index", async () => {
    const page = await indexed("Notes", "quarterly budget review");
    expect((await searchPageContent("budget", 10)).map((h) => h.pageId)).toEqual([page.id]);

    const stamp = new Date("2026-05-05T00:00:00Z");
    await indexPageBody(page.id, "hiring pipeline", stamp);
    expect(await prisma.pageSearchIndex.count()).toBe(1);
    expect(await searchPageContent("budget", 10)).toEqual([]);
    expect((await searchPageContent("pipeline", 10)).map((h) => h.pageId)).toEqual([page.id]);
    const row = await prisma.pageSearchIndex.findUniqueOrThrow({ where: { pageId: page.id } });
    expect(row.sourceUpdatedAt).toEqual(stamp);
  });

  it("drops the row when the body becomes empty", async () => {
    const page = await indexed("Notes", "something here");
    await indexPageBody(page.id, "  \n\n ", new Date());
    expect(await prisma.pageSearchIndex.count()).toBe(0);
  });

  it("truncates stored content to the cap", async () => {
    const page = await indexed("Notes", "word ".repeat(10_000));
    const row = await prisma.pageSearchIndex.findUniqueOrThrow({ where: { pageId: page.id } });
    expect(row.content.length).toBeLessThanOrEqual(INDEX_MAX_CHARS);
  });

  it("is removed with its page (cascade)", async () => {
    const page = await indexed("Notes", "cascade body");
    await prisma.page.delete({ where: { id: page.id } });
    expect(await prisma.pageSearchIndex.count()).toBe(0);
  });

  it("survives concurrent indexing of the same page", async () => {
    const user = await makeUser();
    const page = await makePage(user.id);
    await Promise.all(
      ["alpha one", "bravo two", "charlie three"].map((t) => indexPageBody(page.id, t, new Date())),
    );
    expect(await prisma.pageSearchIndex.count()).toBe(1);
  });
});

describe("searchPageContent exact pass", () => {
  it("matches stems and prefixes", async () => {
    const page = await indexed("Doc", "We hired several designers last term");
    expect((await searchPageContent("design", 10)).map((h) => h.pageId)).toEqual([page.id]);
    expect((await searchPageContent("hirin", 10)).map((h) => h.pageId)).toEqual([page.id]);
  });

  it("requires every term (AND) in the exact pass", async () => {
    await indexed("A", "budget meeting notes");
    await indexed("B", "budget only");
    const hits = await searchPageContent("budget meeting", 10);
    expect(hits.filter((h) => !h.fuzzy).map((h) => h.title)).toEqual(["A"]);
  });

  it("ranks the denser match first", async () => {
    await indexed("Sparse", "filler ".repeat(40) + "roadmap");
    await indexed("Dense", "roadmap roadmap roadmap roadmap");
    const hits = await searchPageContent("roadmap", 10);
    expect(hits[0].title).toBe("Dense");
    expect(hits.every((h) => !h.fuzzy)).toBe(true);
  });

  it("excludes archived pages", async () => {
    await indexed("Gone", "secretword content", { archivedAt: new Date() });
    const live = await indexed("Live", "secretword content");
    expect((await searchPageContent("secretword", 10)).map((h) => h.pageId)).toEqual([live.id]);
  });

  it("honors the limit", async () => {
    for (let i = 0; i < 5; i++) await indexed(`P${i}`, "limitword text");
    expect(await searchPageContent("limitword", 3)).toHaveLength(3);
  });

  it("returns a one-line snippet around the match, without highlight markers", async () => {
    await indexed("Doc", "intro line\n\nsome padding text here\nthe zebra crossing is ahead\nend");
    const [hit] = await searchPageContent("zebra", 5);
    expect(hit.snippet).toContain("zebra");
    expect(hit.snippet).not.toMatch(/\n/);
  });

  it("treats tsquery operator characters as plain text instead of erroring", async () => {
    await indexed("Doc", "plain words");
    await expect(searchPageContent("a & b | !c (d):*", 5)).resolves.toBeDefined();
    await expect(searchPageContent("'; DROP TABLE \"Page\"; --", 5)).resolves.toEqual([]);
    expect(await prisma.page.count()).toBe(1);
  });

  it("returns nothing for blank or all-stopword queries", async () => {
    await indexed("The and", "the and of it is");
    expect(await searchPageContent("   ", 5)).toEqual([]);
    expect(await searchPageContent("the and", 5)).toEqual([]);
  });
});

describe("searchPageContent fuzzy pass", () => {
  it("finds a body by a misspelled word, with a leading excerpt", async () => {
    const page = await indexed("Handbook", "Welcome to onboarding for new members");
    const hits = await searchPageContent("onbaording", 5);
    expect(hits.map((h) => h.pageId)).toEqual([page.id]);
    expect(hits[0].fuzzy).toBe(true);
    expect(hits[0].snippet.startsWith("Welcome")).toBe(true);
  });

  it("finds a page by a misspelled title even with no index row", async () => {
    const user = await makeUser();
    const page = await makePage(user.id, { title: "Onboarding Checklist" });
    const hits = await searchPageContent("onbaording", 5);
    expect(hits.map((h) => h.pageId)).toEqual([page.id]);
  });

  it("excludes archived pages from title and body fuzzy hits", async () => {
    await indexed("Onboarding Archive", "onboarding material", { archivedAt: new Date() });
    expect(await searchPageContent("onbaording", 5)).toEqual([]);
  });

  it("does not run for queries shorter than 4 characters", async () => {
    await indexed("Doc", "alpha beta");
    expect(await searchPageContent("alx", 5)).toEqual([]);
  });

  it("is skipped when the exact pass already filled the limit, and dedupes otherwise", async () => {
    const page = await indexed("Onboarding", "onboarding steps");
    const hits = await searchPageContent("onboarding", 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ pageId: page.id, fuzzy: false });
  });

  it("appends fuzzy hits after exact ones", async () => {
    const exact = await indexed("Exact", "onboarding guide");
    const typo = await indexed("Other", "onbaording guide");
    const hits = await searchPageContent("onboarding", 5);
    expect(hits.map((h) => [h.pageId, h.fuzzy])).toEqual([
      [exact.id, false],
      [typo.id, true],
    ]);
  });

  it("does not leak the lowered similarity threshold to later connections", async () => {
    await indexed("Doc", "alpha beta gamma");
    await searchPageContent("alphq", 5);
    const [{ v }] = await prisma.$queryRaw<{ v: string }[]>`SELECT current_setting('pg_trgm.word_similarity_threshold') AS v`;
    expect(Number(v)).not.toBe(0.4);
  });
});
