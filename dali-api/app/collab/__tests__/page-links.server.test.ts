import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";

// extractPageMentionIds reads via ydocToBlocks which imports prisma + read
// (for persistence); mock them so the test runs without a DB.
vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { extractPageMentionIds } from "../page-links.server";

/** Build a Y.Doc with BlockNote fragment containing pageMention nodes. */
async function docWithPageMentions(pageIds: string[][]): Promise<Y.Doc> {
  const { blocksToFragment } = await import("../blocknote-server");
  const doc = new Y.Doc();
  doc.transact(() => {
    const blocks = pageIds.map((ids, i) => ({
      id: `b${i}`,
      type: "paragraph" as const,
      props: {
        backgroundColor: "default" as const,
        textColor: "default" as const,
        textAlignment: "left" as const,
      },
      content: ids.map((pageId) => ({
        type: "pageMention" as const,
        props: { pageId, label: `Page ${pageId}` },
      })),
      children: [],
    }));
    blocksToFragment(blocks, doc.getXmlFragment("blocknote"));
  });
  return doc;
}

describe("extractPageMentionIds", () => {
  it("collects pageIds from pageMention nodes, deduped", async () => {
    const doc = await docWithPageMentions([
      ["page-1", "page-2"],
      ["page-1", "page-3"],
    ]);
    expect(extractPageMentionIds(doc).sort()).toEqual(["page-1", "page-2", "page-3"]);
  });

  it("returns empty array when no pageMention nodes exist", async () => {
    const doc = await docWithPageMentions([[], []]);
    expect(extractPageMentionIds(doc)).toEqual([]);
  });

  it("ignores pageMention nodes with an empty pageId", async () => {
    const { blocksToFragment } = await import("../blocknote-server");
    const doc = new Y.Doc();
    doc.transact(() => {
      blocksToFragment(
        [
          {
            id: "b1",
            type: "paragraph" as const,
            props: {
              backgroundColor: "default" as const,
              textColor: "default" as const,
              textAlignment: "left" as const,
            },
            // pageId defaults to "" — should be skipped
            content: [{ type: "pageMention" as const, props: { pageId: "", label: "Empty" } }],
            children: [],
          },
        ],
        doc.getXmlFragment("blocknote"),
      );
    });
    expect(extractPageMentionIds(doc)).toEqual([]);
  });

  it("does not pick up user mention nodes", async () => {
    const { blocksToFragment } = await import("../blocknote-server");
    const doc = new Y.Doc();
    doc.transact(() => {
      blocksToFragment(
        [
          {
            id: "b1",
            type: "paragraph" as const,
            props: {
              backgroundColor: "default" as const,
              textColor: "default" as const,
              textAlignment: "left" as const,
            },
            content: [{ type: "mention" as const, props: { id: "user-1", label: "alice" } }],
            children: [],
          },
        ],
        doc.getXmlFragment("blocknote"),
      );
    });
    expect(extractPageMentionIds(doc)).toEqual([]);
  });
});
