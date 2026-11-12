import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/collab/read", () => ({ stateToBlocks: vi.fn(() => ({ blocks: [], source: "blocknote" })) }));
vi.mock("~/components/doc/schema/configs", () => ({ blocksToPlainText: vi.fn(() => "body text") }));
vi.mock("~/lib/doc-search.server", () => ({ indexPageBody: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { indexPageBody } from "~/lib/doc-search.server";
import { runDocSearchIndex } from "~/jobs/doc-search-index.server";

const ctx = (batchSize = 200) => ({
  now: new Date(),
  lastSuccessAt: null,
  settings: { batchSize },
});

let seq = 0;
async function seedPage(opts: {
  edited: Date;
  indexed?: Date;
  archived?: boolean;
  contentDocId?: string;
}) {
  seq += 1;
  const page = await prisma.page.create({
    data: {
      workspaceType: "Lab",
      title: `Page ${seq}`,
      archivedAt: opts.archived ? new Date() : null,
      contentDocId: opts.contentDocId ?? null,
    } as never,
  });
  const name = opts.contentDocId ?? `doc:${page.id}:body`;
  const doc = await prisma.collabDocument.create({ data: { name, state: new Uint8Array([1]) } });
  await prisma.$executeRaw`UPDATE "CollabDocument" SET "updatedAt" = ${opts.edited} WHERE id = ${doc.id}`;
  if (opts.indexed) {
    await prisma.pageSearchIndex.create({
      data: { pageId: page.id, content: "x", sourceUpdatedAt: opts.indexed },
    });
  }
  return page;
}

const day = (n: number) => new Date(Date.UTC(2026, 8, n));

describe("runDocSearchIndex (real database)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("picks stale, never-indexed and overridden rooms, skipping fresh and archived pages, oldest first", async () => {
    const fresh = await seedPage({ edited: day(1), indexed: day(1) });
    const stale = await seedPage({ edited: day(3), indexed: day(1) });
    const never = await seedPage({ edited: day(2) });
    const archived = await seedPage({ edited: day(1), archived: true });
    const overridden = await seedPage({ edited: day(4), contentDocId: "legacy:room:one" });

    const result = await runDocSearchIndex(ctx());

    const order = vi.mocked(indexPageBody).mock.calls.map((c) => c[0]);
    expect(order).toEqual([never.id, stale.id, overridden.id]);
    expect(order).not.toContain(fresh.id);
    expect(order).not.toContain(archived.id);
    expect(result.items).toBe(3);
  });

  it("honors the batch size and reports the leftover count", async () => {
    for (let i = 1; i <= 4; i++) await seedPage({ edited: day(i) });

    const result = await runDocSearchIndex(ctx(3));

    expect(result.items).toBe(3);
    expect(result.note).toContain("1 left for the next run");
  });
});
